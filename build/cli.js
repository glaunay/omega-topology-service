"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = __importDefault(require("commander"));
const fs_1 = __importDefault(require("fs"));
const express_1 = __importDefault(require("express"));
const helpers_1 = require("./helpers");
commander_1.default
    .option('-r, --rebuild <specie>', 'Rebuild partners from mitab & OMTree cache. Specify "all" for rebuilding all trees.')
    .option('-i, --only-interactors', 'Rebuild only interactors couples from mitab. Ignore the mitab full lines.')
    .option('-l, --only-lines', 'Rebuild only stored lines from mitab. Ignore the interactors couples.')
    .option('-t, --threads <number>', 'Number of simultenous request to database when constructing from mitab.', parseInt, 100)
    .option('-c, --rebuild-cache <specie>', 'Rebuild OMTree cache. Specify "all" for rebuilding all the cache.')
    .option('-d, --disable-automatic-rebuild', 'Disable the automatic check of the old cached topologies to rebuild')
    .option('-p, --port <listenPort>', 'Port to open for listening to queries', parseInt, 3455)
    .parse(process.argv);
const CONFIG = JSON.parse(fs_1.default.readFileSync('config.json', { encoding: "utf-8" }));
(async () => {
    // Main process
    if (commander_1.default.rebuild) {
        const with_lines = commander_1.default.onlyLines || !commander_1.default.onlyInteractors;
        const with_partners = !commander_1.default.onlyLines || commander_1.default.onlyInteractors;
        const threads = commander_1.default.threads;
        await helpers_1.reconstructBDD(CONFIG, with_partners, with_lines, threads);
    }
    if (commander_1.default.rebuild || commander_1.default.rebuildCache) {
        let specie = commander_1.default.rebuild || commander_1.default.rebuildCache;
        if (specie === "all") {
            specie = "";
            commander_1.default.disableAutomaticRebuild = true;
        }
        await helpers_1.rebuildAllCache(CONFIG, specie);
    }
    if (!commander_1.default.disableAutomaticRebuild) {
        await helpers_1.automaticCacheBuild(CONFIG);
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
    app.get('/tree/:name', (req, res) => {
        const name = req.params.name;
        // Recheche si l'arbre existe en cache
        if (trees_cache.has(name)) {
            res.setHeader('Content-Type', 'application/json');
            res.send(trees_cache.get(name));
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
    app.listen(commander_1.default.port, () => {
        console.log(`Omega topology service listening on port ${commander_1.default.port}.`);
    });
})();
