"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = __importDefault(require("commander"));
const fs_1 = __importDefault(require("fs"));
const express_1 = __importDefault(require("express"));
const helpers_1 = require("./helpers");
const logger_1 = __importDefault(require("./logger"));
commander_1.default
    .option('-r, --rebuild <specie>', 'Rebuild partners from mitab & OMTree cache. Specify "all" for rebuilding all trees.')
    .option('-i, --only-interactors', 'Rebuild only interactors couples from mitab. Ignore the mitab full lines.')
    .option('-n, --no-serve', 'After rebuild, do not enable server and quit instead', false)
    .option('-m, --only-lines', 'Rebuild only stored lines from mitab. Ignore the interactors couples.')
    .option('-t, --threads <number>', 'Number of simultenous request to database when constructing from mitab.', Number, 100)
    .option('-c, --rebuild-cache <specie>', 'Rebuild OMTree cache. Specify "all" for rebuilding all the cache.')
    .option('-d, --disable-automatic-rebuild', 'Disable the automatic check of the old cached topologies to rebuild')
    .option('-p, --port <listenPort>', 'Port to open for listening to queries', Number, 3455)
    .option('-s, --configFile <configFile>', 'Configuration file. Must be a JSON file implementing the Config interface as defined in helpers.ts', String, 'config.json')
    .option('-l, --log-level [logLevel]', 'Log level [debug|verbose|info|warn|error]', /^(debug|verbose|info|warn|error)$/, 'info')
    .parse(process.argv);
if (commander_1.default.logLevel) {
    logger_1.default.level = commander_1.default.logLevel;
}
const file_config = (function locate(fname) {
    if (!fname) {
        fname = 'config.json';
    }
    if (!fs_1.default.existsSync(fname)) {
        if (!fs_1.default.existsSync(__dirname + "/" + fname)) {
            if (!fname.match(/\.json$/)) {
                return locate(fname + '.json');
            }
            throw new Error("Configuration file could not be loaded: File not found");
        }
        return __dirname + "/" + fname;
    }
    return fname;
})(commander_1.default.configFile);
logger_1.default.verbose("Choosen config file: " + file_config);
const CONFIG = JSON.parse(fs_1.default.readFileSync(file_config, { encoding: "utf-8" }));
(async () => {
    // Main process
    if (commander_1.default.rebuild) {
        logger_1.default.debug("Rebuilding MI Tab in CouchDB");
        const with_lines = commander_1.default.onlyLines || !commander_1.default.onlyInteractors;
        const with_partners = !commander_1.default.onlyLines || commander_1.default.onlyInteractors;
        const threads = commander_1.default.threads;
        logger_1.default.debug(`With MI Tab lines: ${Boolean(with_lines)}; With simple partners: ${Boolean(with_partners)}.`);
        logger_1.default.debug(`Thread number: ${threads}`);
        await helpers_1.reconstructBDD(CONFIG, with_partners, with_lines, threads);
    }
    if (commander_1.default.rebuild || commander_1.default.rebuildCache) {
        let specie = commander_1.default.rebuild || commander_1.default.rebuildCache;
        if (specie === "all") {
            specie = "";
            commander_1.default.disableAutomaticRebuild = true;
        }
        else {
            specie = specie.toLocaleUpperCase();
        }
        await helpers_1.rebuildAllCache(CONFIG, specie);
    }
    if (!commander_1.default.disableAutomaticRebuild) {
        await helpers_1.automaticCacheBuild(CONFIG);
    }
    if (!commander_1.default.serve) {
        return;
    }
    // Now, listen to queries !
    const app = express_1.default();
    // Instanciate a anon class
    const trees_cache = new class {
        constructor(threshold = 5) {
            this.threshold = threshold;
            this.data = {};
            this.insertion_order = [];
        }
        get(n) {
            return this.data[n];
        }
        has(n) {
            return n in this.data;
        }
        set(n, data) {
            if (!this.has(n)) {
                this.insertion_order.push(n);
                if (this.length >= this.threshold) {
                    const first_inserted = this.insertion_order.shift();
                    delete this.data[first_inserted];
                }
            }
            this.data[n] = data;
        }
        get length() {
            return Object.keys(this.data).length;
        }
    };
    app.use((_, res, next) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
        next();
    });
    app.get('/tree/:name', (req, res) => {
        const name = req.params.name.toLocaleUpperCase();
        // Recheche si l'arbre existe en cache
        if (trees_cache.has(name)) {
            res.setHeader('Content-Type', 'application/json');
            res.send(trees_cache.get(name));
        }
        else {
            // Récupère le fichier
            const full_name = `uniprot_${name}_homology.topology`;
            console.log("Getting", CONFIG.cache + full_name);
            fs_1.default.exists(CONFIG.cache + full_name, exists => {
                if (exists) {
                    fs_1.default.readFile(CONFIG.cache + full_name, "utf-8", (err, data) => {
                        if (err) {
                            res.status(500).send();
                        }
                        else {
                            trees_cache.set(name, data);
                            res.setHeader('Content-Type', 'application/json');
                            res.send(trees_cache.get(name));
                        }
                    });
                }
                else {
                    res.status(404).send();
                }
            });
        }
    });
    app.listen(commander_1.default.port, '0.0.0.0', () => {
        console.log(`Omega topology service listening on port ${commander_1.default.port}.`);
    });
})();
