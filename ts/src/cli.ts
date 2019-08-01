import commander from 'commander';
import fs from 'fs';
import express from 'express';
import { Config, reconstructBDD, automaticCacheBuild, rebuildAllCache, renewDatabase } from './helpers';
import logger from './logger';

commander
    .option('-r, --rebuild <specie>', 'Rebuild partners from mitab & OMTree cache. Specify "all" for rebuilding all trees.')
    .option('-i, --only-interactors', 'Rebuild only interactors couples from mitab. Ignore the mitab full lines.')
    .option('-n, --no-serve', 'After rebuild, do not enable server and quit instead', false)
    .option('-m, --only-lines', 'Rebuild only stored lines from mitab. Ignore the interactors couples.')
    .option('-t, --threads <number>', 'Number of simultenous request to database when constructing from mitab.', Number, 1000)
    .option('-c, --rebuild-cache <specie>', 'Rebuild OMTree cache. Specify "all" for rebuilding all the cache.')
    .option('-d, --disable-automatic-rebuild', 'Disable the automatic check of the old cached topologies to rebuild')
    .option('-h, --no-internal-cache', 'Disable the internal JavaScript cache when a cached topology is read. It mean that every time a user wants to topology, it will be fetched from the file system !')
    .option('-p, --port <listenPort>', 'Port to open for listening to queries', Number, 3455)
    .option('-s, --configFile <configFile>', 'Configuration file. Must be a JSON file implementing the Config interface as defined in helpers.ts', String, 'config.json')
    .option('-l, --log-level [logLevel]', 'Log level [debug|verbose|info|warn|error]', /^(debug|verbose|info|warn|error)$/, 'info')
.parse(process.argv);

if (commander.logLevel) {
    logger.level = commander.logLevel;
}

const file_config = (function locate(fname: string) {
    if (!fname) {
        fname = 'config.json';
    }
     
    if (!fs.existsSync(fname)) {
        if (!fs.existsSync(__dirname + "/" + fname)) {
            if (!fname.match(/\.json$/)) {
                return locate(fname + '.json');
            }

            throw new Error("Configuration file could not be loaded: File not found");
        }
        return __dirname + "/" + fname;
    }

    return fname;
})(commander.configFile);

logger.verbose("Choosen config file: " + file_config);

const CONFIG = JSON.parse(fs.readFileSync(file_config, { encoding: "utf-8" })) as Config;

(async () => {
    // Main process
    if (commander.rebuild) {    
        logger.debug("Rebuilding MI Tab in CouchDB");

        const with_lines = commander.onlyLines || !commander.onlyInteractors;
        const with_partners = !commander.onlyLines || commander.onlyInteractors;
        const threads = commander.threads;

        logger.debug(`With MI Tab lines: ${Boolean(with_lines)}; With simple partners: ${Boolean(with_partners)}.`);
        logger.debug(`Thread number: ${threads}`);

        await reconstructBDD(CONFIG, with_partners, with_lines, threads);
    }
    
    if (commander.rebuild || commander.rebuildCache) {
        let specie: string = commander.rebuild || commander.rebuildCache;
    
        if (specie === "all") {
            specie = "";
            commander.disableAutomaticRebuild = true;
        }
        else {
            specie = specie.toLocaleUpperCase();
        }
    
        await rebuildAllCache(CONFIG, specie);
    }

    if (!commander.disableAutomaticRebuild) {
        await automaticCacheBuild(CONFIG);

        // Setup the interval who will rebuild cache every max_days_before_cache_renew
        setInterval(async () => {
            logger.verbose("Starting a automatic rebuild.");
            await automaticCacheBuild(CONFIG);
        }, 1000 * 60 * 60 * 24 * CONFIG.max_days_before_renew); // Wait max_days_before_renew days before renew
    }

    if (!commander.serve) {
        return;
    }

    // Now, listen to queries !
    const app = express();
    // Instanciate a anon class
    const trees_cache = new class {
        protected data: {[treeName: string]: [string, number]} = {};
        protected insertion_order: string[] = [];
        protected interval: NodeJS.Timeout = undefined;

        constructor(protected threshold = 5) {
            if (commander.internalCache) {
                logger.debug("Configuring automatic internal cache update");
                this.configureInterval();
            }
        }

        configureInterval() {
            // Toutes les deux minutes, check si un arbre est outdated
            this.interval = setInterval(() => {
                const to_remove: string[] = [];

                // Obtient tous les arbres et leur mtime
                const files: [string, number][] = fs.readdirSync(CONFIG.cache).map(f => [f, fs.statSync(CONFIG.cache + "/" + f).mtimeMs]);

                const files_map: any = {};
                for (const [k, f] of files) {
                    files_map[k] = f;
                }

                for (const [key, value] of Object.entries(this.data)) {
                    const [, timeout] = value;

                    // Si l'arbre a changé depuis l'enregistrement
                    if (key in files_map) {
                        if (timeout !== files_map[key]) {
                            to_remove.push(key);
                        }
                    }
                }

                // Supprime les arbres dépassés
                for (const k of to_remove) {
                    delete this.data[k];
                }
            }, CONFIG.max_min_before_cache_update * 60 * 1000);
        }

        stopInterval() {
            clearInterval(this.interval);
        }

        get(n: string) {
            return this.data[n][0];
        }

        has(n: string) {
            return n in this.data;
        }

        set(n: string, data: string, ms: number) {
            if (!this.has(n)) {
                this.insertion_order.push(n);

                if (this.length >= this.threshold) {
                    const first_inserted = this.insertion_order.shift();
                    delete this.data[first_inserted];
                }
            }

            this.data[n] = [data, ms];
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
        const name = (req.params.name as string).toLocaleUpperCase();

        // Recheche si l'arbre existe en cache
        if (trees_cache.has(name)) {
            res.setHeader('Content-Type', 'application/json');
            res.send(trees_cache.get(name));
        }
        else {
            // Récupère le fichier
            const full_name = `uniprot_${name}_homology.topology`;

            logger.info("Getting", CONFIG.cache + full_name);

            fs.exists(CONFIG.cache + full_name, exists => {
                if (exists) {
                    const mtime = fs.statSync(CONFIG.cache + full_name).mtimeMs;

                    fs.readFile(CONFIG.cache + full_name, "utf-8", (err, data) => {
                        if (err) {
                            res.status(500).send();
                        }
                        else {
                            if (commander.internalCache) {
                                trees_cache.set(name, data, mtime);
                            }

                            res.setHeader('Content-Type', 'application/json');
                            res.send(trees_cache.get(name));
                        }
                    })
                }
                else {
                    res.status(404).json({ status: false, error: "File not found" });
                }
            });
        }
    });

    app.listen(commander.port, '0.0.0.0', () => {
        console.log(`Omega topology service listening on port ${commander.port}.`);
    });
})();
