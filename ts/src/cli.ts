import commander from 'commander';
import fs from 'fs';
import express from 'express';
import { Config, reconstructBDD, automaticCacheBuild, rebuildAllCache } from './helpers';

commander
    .option('-r, --rebuild <specie>', 'Rebuild partners from mitab & OMTree cache. Specify "all" for rebuilding all trees.')
    .option('-i, --only-interactors', 'Rebuild only interactors couples from mitab. Ignore the mitab full lines.')
    .option('-l, --only-lines', 'Rebuild only stored lines from mitab. Ignore the interactors couples.')
    .option('-t, --threads <number>', 'Number of simultenous request to database when constructing from mitab.', parseInt, 100)
    .option('-c, --rebuild-cache <specie>', 'Rebuild OMTree cache. Specify "all" for rebuilding all the cache.')
    .option('-d, --disable-automatic-rebuild', 'Disable the automatic check of the old cached topologies to rebuild')
    .option('-p, --port <listenPort>', 'Port to open for listening to queries', parseInt, 3455)
.parse(process.argv);


const CONFIG = JSON.parse(fs.readFileSync('config.json', { encoding: "utf-8" })) as Config;

(async () => {
    // Main process
    if (commander.rebuild) {    
        const with_lines = commander.onlyLines || !commander.onlyInteractors;
        const with_partners = !commander.onlyLines || commander.onlyInteractors;
        const threads = commander.threads;

        await reconstructBDD(CONFIG, with_partners, with_lines, threads);
    }
    
    if (commander.rebuild || commander.rebuildCache) {
        let specie: string = commander.rebuild || commander.rebuildCache;
    
        if (specie === "all") {
            specie = "";
            commander.disableAutomaticRebuild = true;
        }
    
        await rebuildAllCache(CONFIG, specie);
    }

    if (!commander.disableAutomaticRebuild) {
        await automaticCacheBuild(CONFIG);
    }

    // Now, listen to queries !
    const app = express();
    // Instanciate a anon class
    const trees_cache = new class {
        protected data: {[treeName: string]: string} = {};
        protected insertion_order: string[] = [];

        constructor(protected threshold = 5) { }

        get(n: string) {
            return this.data[n];
        }

        has(n: string) {
            return n in this.data;
        }

        set(n: string, data: string) {
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
        const name = req.params.name as string;

        // Recheche si l'arbre existe en cache
        if (trees_cache.has(name)) {
            res.setHeader('Content-Type', 'application/json');
            res.send(trees_cache.get(name));
        }
        else {
            // Récupère le fichier
            const full_name = `uniprot_${name}_homology.topology`;

            console.log("Getting", CONFIG.cache + full_name)
            fs.exists(CONFIG.cache + full_name, exists => {
                if (exists) {
                    fs.readFile(CONFIG.cache + full_name, "utf-8", (err, data) => {
                        if (err) {
                            res.status(500).send();
                        }
                        else {
                            trees_cache.set(name, data);
                            res.setHeader('Content-Type', 'application/json');
                            res.send(trees_cache.get(name));
                        }
                    })
                }
                else {
                    res.status(404).send();
                }
            });
        }
    });

    app.listen(commander.port, () => {
        console.log(`Omega topology service listening on port ${commander.port}.`);
    });
})();
