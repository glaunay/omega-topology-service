"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const PSICQuic_1 = __importDefault(require("./PSICQuic"));
const commander_1 = __importDefault(require("commander"));
const fs_1 = __importDefault(require("fs"));
const nano_1 = __importDefault(require("nano"));
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const helpers_1 = require("./helpers");
commander_1.default
    .option('-r, --rebuild <specie>', 'Rebuild partners from mitab & OMTree cache. Specify "all" for rebuilding all trees.')
    .option('-i, --only-interactors', 'Rebuild only interactors couples from mitab. Ignore the mitab full lines.')
    .option('-l, --only-lines', 'Rebuild only stored lines from mitab. Ignore the interactors couples.')
    .option('-t, --threads <number>', 'Number of simultenous request to database when constructing from mitab.', parseInt, 100)
    .option('-c, --rebuild-cache <specie>', 'Rebuild OMTree cache. Specify "all" for rebuilding all the cache.')
    .option('-d, --disable-automatic-rebuild', 'Disable the automatic check of the old cached topologies to rebuild')
    .option('-p, --port <listenPort>', 'Port to open for listening to queries', 3455)
    .parse(process.argv);
const CONFIG = JSON.parse(fs_1.default.readFileSync('config.json', { encoding: "utf-8" }));
const MAX_TIME = 1000 * 60 * 60 * 24 * CONFIG.max_days_before_renew; // 15 jours par défaut
(async () => {
    // Main process
    if (commander_1.default.rebuild) {
        const with_lines = commander_1.default.onlyLines || !commander_1.default.onlyInteractors;
        const with_partners = !commander_1.default.onlyLines || commander_1.default.onlyInteractors;
        console.log(`Rebuilding ${with_partners ? "partners" : 'only'} ${with_lines ? (with_partners ? "and " : "") + "lines" : ''}.`);
        const nn = nano_1.default(CONFIG.couchdb);
        // Reconstruction de la base de données
        // 1) Lecture du mitab entier (CONFIG.mitab)
        console.log("Reading Mitab file");
        const psq = new PSICQuic_1.default(undefined, with_lines);
        let t = Date.now();
        await psq.read(CONFIG.mitab);
        console.log("Read completed in ", (Date.now() - t) / 1000, " seconds");
        // 2) Vidage de l'existant
        // & 3) Construction des documents (interactors et id_map)
        console.log("Recreate current database.");
        await helpers_1.renewDatabase(nn, with_partners, with_lines);
        const before_run = http_1.default.globalAgent.maxSockets;
        http_1.default.globalAgent.maxSockets = 200;
        if (with_partners) {
            // 4) Obtention des paires id => partners[]
            console.log("Getting partners");
            const pairs = psq.getAllPartnersPairs();
            // 5) Insertion des paires (peut être long)
            console.log("Inserting interactors partners in CouchDB");
            await helpers_1.registerPairs(nn, pairs, commander_1.default.threads);
            console.log("Pairs has been successfully registered");
        }
        if (with_lines) {
            // 6) Obtention des objets id => { [partners]: lignes_liees[] }
            console.log("Getting raw lines to insert");
            const lines = psq.getAllLinesPaired();
            // 7) Insertion des lignes (peut être long)
            console.log("Inserting raw lines in CouchDB");
            await helpers_1.registerLines(nn, lines, commander_1.default.threads);
            console.log("Lines has been successfully registered");
            console.log("Flushing PSICQuic object");
            psq.flushRaw();
        }
        http_1.default.globalAgent.maxSockets = before_run;
        console.log("Rebuilding of the database is complete.");
    }
    if (commander_1.default.rebuild || commander_1.default.rebuildCache) {
        let specie = commander_1.default.rebuild || commander_1.default.rebuildCache;
        if (specie === "all") {
            specie = "";
            commander_1.default.disableAutomaticRebuild = true;
        }
        // Vérifie que l'espèce existe dans les fichiers homologyTree
        let files = fs_1.default.readdirSync(CONFIG.trees).filter(f => f.match(/\.json$/));
        if (specie) {
            const escaped = helpers_1.escapeRegExp(specie);
            const match = new RegExp("^uniprot_" + escaped + "_homology\\.json$", "i");
            console.log(`Looking for specie "${specie}" into "${CONFIG.trees}".`);
            const tree = files.find(e => match.test(e));
            if (!tree) {
                // aucune espèce ne correspond
                console.error(`Any specie has matched "${specie}" while searching for homology trees. Exiting.`);
                process.exit(1);
            }
            files = [tree];
        }
        await helpers_1.rebuildTreesFrom(CONFIG, files);
    }
    if (!commander_1.default.disableAutomaticRebuild) {
        let tree_files = fs_1.default.readdirSync(CONFIG.trees).filter(f => f.match(/\.json$/));
        let files = fs_1.default.readdirSync(CONFIG.cache).filter(f => f.match(/\.topology$/));
        // Recherche des arbres qui n'existent pas dans le cache (donc à construire)
        tree_files = tree_files.filter(f => !files.includes(f.replace('.json', '.topology')));
        const missing = tree_files.length;
        // Recherche des fichiers .topology à actualiser
        files = files
            .map(f => [f, fs_1.default.statSync(CONFIG.cache + f).mtime]) // Recherche le mtime de chaque fichier et renvoie un [name, date]
            .filter(f => f[1].getTime() < (Date.now() - MAX_TIME)) // Gare si date_fichier < actuelle - temps max (temps max dépassé)
            .map(f => f[0]) // Renvoie uniquement le nom du fichier
            .map(f => f.replace('.topology', '.json')) // Transforme les fichiers *.topology en *.json
            .filter(f => {
            if (!fs_1.default.existsSync(CONFIG.trees + f)) {
                console.error(`File ${f} does not exists when rebuilding from cache. Has ${f.replace('.json', '.topology')} related tree changed name ?`);
                return false;
            }
            return true;
        });
        const outdated = files.length;
        files.push(...tree_files);
        if (files.length > 0) {
            console.log(`${missing} missing tree${missing > 1 ? 's' : ''} in cache, ${outdated} outdated tree${outdated > 1 ? 's' : ''} has been detected. (Re)building...\n`);
            await helpers_1.rebuildTreesFrom(CONFIG, files);
        }
    }
    // Now, listen to queries !
    const app = express_1.default();
    const trees_cache = {};
    app.get('/tree/:name', (req, res) => {
        const name = req.params.name;
        // Recheche si l'arbre existe en cache
        if (name in trees_cache) {
            res.setHeader('Content-Type', 'application/json');
            res.send(trees_cache[name]);
        }
        else {
            // Récupère le fichier
            const full_name = `uniprot_${name}_homology.json`;
            fs_1.default.exists(CONFIG.trees + full_name, exists => {
                if (exists) {
                    fs_1.default.readFile(CONFIG.trees + full_name, "utf-8", (err, data) => {
                        if (err) {
                            res.status(500).send();
                        }
                        else {
                            trees_cache[name] = data;
                            res.setHeader('Content-Type', 'application/json');
                            res.send(trees_cache[name]);
                        }
                    });
                }
                else {
                    res.status(404).send();
                }
            });
        }
    });
    app.listen(commander_1.default.port, () => {
        console.log(`Omega topology service listening on port ${commander_1.default.port}.`);
    });
})();
