import PSICQuic from './PSICQuic';
import commander from 'commander';
import fs from 'fs';
import nano from 'nano';
import http from 'http';
import { escapeRegExp, renewDatabase, registerPairs, registerLines, Config, rebuildTreesFrom } from './helpers';

// const file = "/Users/lberanger/dataOmega/mitab200K.mitab"; // merged_uniprot_safe.mitab

// (async () => {
//     const psq = new PSICQuic();
    
//     let t = Date.now();

//     await psq.read(file);

//     console.log("Read in ", (Date.now() - t) / 1000, " seconds");

//     let i = 0;
//     for (const couple of psq.couples()) {
//         if (i > 2) break;

//         if (couple[2].length > 2) {
//             console.log(couple); i++;
//         }
//     }
// })();

commander
    .option('-r, --rebuild <specie>', 'Rebuild partners from mitab & OMTree cache. Specify "all" for rebuilding all trees.')
    .option('-i, --only-interactors', 'Rebuild only interactors couples from mitab. Ignore the mitab full lines.')
    .option('-l, --only-lines', 'Rebuild only stored lines from mitab. Ignore the interactors couples.')
    .option('-t, --threads <number>', 'Number of simultenous request to database when constructing from mitab.', parseInt, 100)
    .option('-c, --rebuild-cache <specie>', 'Rebuild OMTree cache. Specify "all" for rebuilding all the cache.')
    .option('-d, --disable-automatic-rebuild', 'Disable the automatic check of the old cached topologies to rebuild')
.parse(process.argv);

const MAX_TIME = 1000 * 60 * 60 * 24 * 15; // 15 jours 

const CONFIG = JSON.parse(fs.readFileSync('config.json', { encoding: "utf-8" })) as Config;

(async () => {
    // Main process
    if (commander.rebuild) {    
        const with_lines = commander.onlyLines || !commander.onlyInteractors;
        const with_partners = !commander.onlyLines || commander.onlyInteractors;

        console.log(`Rebuilding ${with_partners ? "partners" : 'only'} ${with_lines ? (with_partners ? "and " : "") + "lines" : ''}.`);

        const nn = nano(CONFIG.couchdb);

        // Reconstruction de la base de données
    
        // 1) Lecture du mitab entier (CONFIG.mitab)
        console.log("Reading Mitab file");
        const psq = new PSICQuic(undefined, with_lines);
        let t = Date.now();
        await psq.read(CONFIG.mitab);
        console.log("Read completed in ", (Date.now() - t) / 1000, " seconds");

        // 2) Vidage de l'existant
        // & 3) Construction des documents (interactors et id_map)
        console.log("Recreate current database.");
        await renewDatabase(nn, with_partners, with_lines);

        const before_run = http.globalAgent.maxSockets;
        http.globalAgent.maxSockets = 200;

        if (with_partners) {
            // 4) Obtention des paires id => partners[]
            console.log("Getting partners");
            const pairs = psq.getAllPartnersPairs();

            // 5) Insertion des paires (peut être long)
            console.log("Inserting interactors partners in CouchDB");
            await registerPairs(nn, pairs, commander.threads);
            console.log("Pairs has been successfully registered")
        }
       
        if (with_lines) {
            // 6) Obtention des objets id => { [partners]: lignes_liees[] }
            console.log("Getting raw lines to insert");
            const lines = psq.getAllLinesPaired();

            // 7) Insertion des lignes (peut être long)
            console.log("Inserting raw lines in CouchDB");
            await registerLines(nn, lines, commander.threads)
            console.log("Lines has been successfully registered");

            console.log("Flushing PSICQuic object");
            psq.flushRaw();
        }

        http.globalAgent.maxSockets = before_run;
        console.log("Rebuilding of the database is complete.");
    }
    
    if (commander.rebuild || commander.rebuildCache) {
        let specie: string = commander.rebuild || commander.rebuildCache;
    
        if (specie === "all") {
            specie = "";
            commander.disableAutomaticRebuild = true;
        }
    
        // Vérifie que l'espèce existe dans les fichiers homologyTree
        let files = fs.readdirSync(CONFIG.trees).filter(f => f.match(/\.json$/));
        if (specie) {
            const escaped = escapeRegExp(specie);
            const match = new RegExp("^uniprot_" + escaped + "_homology\\.json$", "i");

            console.log(`Looking for specie "${specie}" into "${CONFIG.trees}".`)
            const tree = files.find(e => match.test(e));
            if (!tree) {
                // aucune espèce ne correspond
                console.error(`Any specie has matched "${specie}" while searching for homology trees. Exiting.`);
                process.exit(1);
            }

            files = [tree];
        }

        await rebuildTreesFrom(CONFIG, files);
    }

    if (!commander.disableAutomaticRebuild) {
        let tree_files = fs.readdirSync(CONFIG.trees).filter(f => f.match(/\.json$/));
        let files = fs.readdirSync(CONFIG.cache).filter(f => f.match(/\.topology$/));

        // Recherche des arbres qui n'existent pas dans le cache (donc à construire)
        tree_files = tree_files.filter(f => !files.includes(f.replace('.json', '.topology')));
        const missing = tree_files.length;

        // Recherche des fichiers .topology à actualiser
        files = files
            .map(f => [f, fs.statSync(CONFIG.cache + f).mtime]) // Recherche le mtime de chaque fichier et renvoie un [name, date]
            .filter(f => (f[1] as Date).getTime() < (Date.now() - MAX_TIME)) // Gare si date_fichier < actuelle - temps max (temps max dépassé)
            .map(f => f[0] as string) // Renvoie uniquement le nom du fichier
            .map(f => f.replace('.topology', '.json')) // Transforme les fichiers *.topology en *.json
            .filter(f => { // Vérifie si le fichier associé existe
                if (!fs.existsSync(CONFIG.trees + f)) {
                    console.error(`File ${f} does not exists when rebuilding from cache. Has ${f.replace('.json', '.topology')} related tree changed name ?`);
                    
                    return false;
                }

                return true;
            });
        const outdated = files.length;

        files.push(...tree_files);

        if (files.length > 0) {
            console.log(`${missing} missing tree${missing > 1 ? 's' : ''} in cache, ${outdated} outdated tree${outdated > 1 ? 's' : ''} has been detected. (Re)building...\n`);
            await rebuildTreesFrom(CONFIG, files);
        }
    }
})();
