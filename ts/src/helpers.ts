import fs from 'fs';
import http from 'http';
import nano, { MaybeDocument } from 'nano';
import ProgressBar from 'progress';
import v8 from 'v8';
import OmegaTopology, { HomologyTree, PSICQuic } from 'omega-topology-fullstack';
import logger from './logger';

export interface Config {
    /** Trees directory. Must contains only .json homology trees. */
    trees: string, 
    /** MI Tab file (common for all species) */
    mitab: string, 
    /** CouchDB database URL (with port) */
    couchdb: string, 
    /** Cache directory. MUST be created. Where the cached skeletons will be stored. */
    cache: string, 
    /** Maximum days until auto cache renew. */
    max_days_before_renew: number, 
    /** omegalomodb request agregator URL */
    omegalomodb: string, 
    /** Database names, where the MI Tab file will be stored into CouchDB. */
    databases: { 
        /** Interactors couples. { [id1: string]: ListOfInteractorsIdOfId1<string> } */
        partners: string, 
        /** Interactors couples, with MI Tab lines. { [id1: string]: { [interactorId: string]: ListOfMitabLinesOf[Id1:interactorId]Interaction<string> } }  */
        mitab_lines: string 
    },
    /** On skeleton construct, parameters that will be transmitted 
     * to the `trimEdges` method of the OmegaToplogy object.
     * False mean no parameter. */
    auto_trim: false | {
        idPct: number,
        simPct: number,
        cvPct: number
    }
}

/**
 * Escape characters of a regular expression.
 *
 * @param {string} string
 * @returns {string}
 */
export function escapeRegExp(string: string) : string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

/**
 * Rebuild tree cache from files array (filename, pointing to *.json trees)
 *
 * @param {Config} CONFIG
 * @param {string[]} files
 * @returns {Promise<void>}
 */
export async function rebuildTreesFrom(CONFIG: Config, files: string[]) : Promise<void> {
    // Lecture des fichiers d'arbre à construire
    const topologies: OmegaTopology[] = [];
    for (const f of files) {
        logger.debug("Reading" + f);

        const this_tree = new HomologyTree(CONFIG.trees + f);
        await this_tree.init();
        topologies.push(new OmegaTopology(this_tree));
    }

    logger.info("Trees has been read, constructing graphes.\n");

    const total_length = topologies.reduce((previous, current) => {
        return previous + current.hDataLength;
    }, 0);

    let trim_parameters = Object.assign({}, {
        definitive: true,
        destroy_identical: true
    });

    if (CONFIG.auto_trim) {
        trim_parameters = { ...CONFIG.auto_trim, ...trim_parameters };
    }

    const bar = new ProgressBar(":tree: :current/:total completed (:percent, :etas remaining, :elapsed taken)", total_length);
    let i = 0;
    for (const t of topologies) {
        bar.tick(0, { tree: `Constructing ${files[i]}` });

        await t.init();

        await t.buildEdgesReverse(CONFIG.omegalomodb + "/bulk", bar);

        t.trimEdges(trim_parameters);

        i++;
    }

    bar.terminate();

    logger.verbose("Saving trees to cache.");
    i = 0;
    try { fs.mkdirSync(CONFIG.cache) } catch (e) { }

    for (const t of topologies) {
        const filename = files[i].replace('.json', '.topology');
        fs.writeFileSync(CONFIG.cache + filename, t.serialize(false));

        logger.verbose(`${files[i]}'s tree cache has been saved.`);
        i++;
    }

    logger.info("Trees has been rebuilt.");
}

/**
 * Empty the databases and recreate it.
 *
 * @param {nano.ServerScope} nn
 * @param {boolean} renew_partners
 * @param {boolean} renew_lines
 * @returns {Promise<void>}
 */
export async function renewDatabase(CONFIG: Config, nn: nano.ServerScope, renew_partners: boolean, renew_lines: boolean) : Promise<void> {
    if (renew_partners) {
        logger.debug(`Destroying partners database (${CONFIG.databases.partners})`);
        await nn.db.destroy(CONFIG.databases.partners).catch(() => {});
    }
    if (renew_lines) {
        logger.debug(`Destroying MI Tab lines database (${CONFIG.databases.mitab_lines})`);
        await nn.db.destroy(CONFIG.databases.mitab_lines).catch(() => {});
    } 
}

/**
 * Register all the pairs in the CouchDB database
 *
 * @param {nano.ServerScope} nn
 * @param {{ [id: string]: Iterable<string> }} pairs
 * @param {number} [max_paquet=100]
 */
export async function registerPairs(CONFIG: Config, nn: nano.ServerScope, pairs: { [id: string]: Iterable<string> }, max_paquet = 1000) {
    const document_name = CONFIG.databases.partners;

    logger.debug(`Creating database ${document_name}`);
    await nn.db.create(document_name).catch(() => {});

    const id_db = nn.use(document_name);

    const total = Object.keys(pairs).length;
    logger.debug(`${total} total pairs to insert`);

    const bar = new ProgressBar(':current/:total :bar (:percent, :etas) ', { total, complete: "=", incomplete: " ", head: '>' });

    const create_document = id => { return { _id: id, partners: pairs[id] } as MaybeDocument };
    const insert_many = ids => id_db.bulk({ docs: ids.map(id => create_document(id)) });

    let ids_to_push = [];

    for (const id in pairs) {
        ids_to_push.push(id);

        if (ids_to_push.length >= max_paquet) {
            await insert_many(ids_to_push).catch(() => insert_many(ids_to_push));
            bar.tick(ids_to_push.length);

            ids_to_push = [];
        }
    }

    if (ids_to_push.length)
        await insert_many(ids_to_push);

    bar.tick(ids_to_push.length);
    bar.terminate();
}

/**
 * Register all the mitab lines in the CouchDB database
 *
 * @param {nano.ServerScope} nn
 * @param {{ [id: string]: { [coupledId: string]: string[] } }} pairs
 * @param {number} [max_paquet=100]
 */
export async function registerLines(CONFIG: Config, nn: nano.ServerScope, pairs: { [id: string]: { [coupledId: string]: string[] } }, max_paquet = 100) {
    const document_name = CONFIG.databases.mitab_lines;

    logger.debug(`Creating database ${document_name}`);
    await nn.db.create(document_name).catch(() => {});

    const interactors = nn.use(document_name);

    const total = Object.keys(pairs).length;
    logger.debug(`${total} total pairs to insert`);

    const bar = new ProgressBar(':current/:total :bar (:percent, :etas) ', { total, complete: "=", incomplete: " ", head: '>' });

    const create_document = id => { return { _id: id, data: pairs[id] } as MaybeDocument };
    const insert_many = ids => interactors.bulk({ docs: ids.map(id => create_document(id)) });

    let ids_to_push = [];

    for (const id in pairs) {
        ids_to_push.push(id);

        if (ids_to_push.length >= max_paquet) {
            await insert_many(ids_to_push).catch(() => insert_many(ids_to_push));
            bar.tick(ids_to_push.length);

            ids_to_push = [];
        }
    }

    if (ids_to_push.length)
        await insert_many(ids_to_push);

    bar.tick(ids_to_push.length);
    bar.terminate();
}

/**
 * Rebuild from scratch the Couch database.
 *
 * @param {Config} CONFIG
 * @param {boolean} with_partners
 * @param {boolean} with_lines
 * @param {number} threads
 */
export async function reconstructBDD(CONFIG: Config, with_partners: boolean, with_lines: boolean, threads: number) {
    logger.info(`Rebuilding ${with_partners ? "partners" : 'only'} ${with_lines ? (with_partners ? "and " : "") + "lines" : ''}.`);

    logger.debug('Creating Nano Couch object');
    const nn = nano(CONFIG.couchdb);

    const heap_size = v8.getHeapStatistics().heap_size_limit;

    if (heap_size < 5 * 1024 * 1024 * 1024) {
        logger.error(`Allocated memory is too low (${(heap_size / (1024 * 1024)).toFixed(1)} Mo). Please use --max-old-space-size=8192`);
    }

    // Reconstruction de la base de données
    const before_run = http.globalAgent.maxSockets;
    http.globalAgent.maxSockets = 200;

    // 1) Lecture du mitab entier (CONFIG.mitab)
    logger.info("Reading global Mitab file");

    ////// TODO TOCHANGE : En stream, sans objet PSICQuic
    const psq = new PSICQuic(undefined, with_lines);
    let t = Date.now();
    await psq.read(CONFIG.mitab);
    logger.verbose("Read completed in ", (Date.now() - t) / 1000, " seconds");

    // 2) Vidage de l'existant
    // & 3) Construction des documents (interactors et id_map)
    logger.info("Recreate current database.");
    await renewDatabase(CONFIG, nn, with_partners, with_lines);

    if (with_partners) {
        // 4) Obtention des paires id => partners[]
        logger.info("Getting partners");
        const pairs = psq.getAllPartnersPairs();

        // 5) Insertion des paires (peut être long)
        logger.info("Inserting interactors partners in CouchDB");
        await registerPairs(CONFIG, nn, pairs, threads);
        logger.verbose("Pairs has been successfully registered")
    }

    if (with_lines) {
        // 6) Obtention des objets id => { [partners]: lignes_liees[] }
        logger.debug("Getting raw lines to insert");
        const lines = psq.getAllLinesPaired();

        // 7) Insertion des lignes (peut être long)
        logger.info("Inserting raw lines in CouchDB");
        await registerLines(CONFIG, nn, lines, threads)
        logger.verbose("Lines has been successfully registered");

        logger.debug("Flushing PSICQuic object");
        psq.flushRaw();
    }

    logger.info(`Rebuilding of the database is complete.`);
    
    http.globalAgent.maxSockets = before_run;
}

/**
 * Rebuild all the tree cache using *.json files in CONFIG.trees
 * @export
 * @param {Config} CONFIG
 * @param {string} [specie]
 */
export async function rebuildAllCache(CONFIG: Config, specie?: string) {
    // Vérifie que l'espèce existe dans les fichiers homologyTree
    logger.debug(`Searching JSON files in ${CONFIG.trees}`);
    let files = fs.readdirSync(CONFIG.trees).filter(f => f.match(/\.json$/));

    if (specie) {
        const escaped = escapeRegExp(specie);
        const match = new RegExp("^uniprot_" + escaped + "_homology\\.json$", "i");

        logger.info(`Looking for specie "${specie}" into "${CONFIG.trees}".`)
        const tree = files.find(e => match.test(e));
        if (!tree) {
            // aucune espèce ne correspond
            logger.error(`Any specie has matched "${specie}" while searching for homology trees. Exiting.`);
            return;
        }

        files = [tree];
    }

    await rebuildTreesFrom(CONFIG, files);
}

/**
 * Renew tree cache and create missing trees automatically.
 *
 * @param {Config} CONFIG
 */
export async function automaticCacheBuild(CONFIG: Config) {
    const MAX_TIME = 1000 * 60 * 60 * 24 * CONFIG.max_days_before_renew; // 15 jours par défaut

    try { fs.mkdirSync(CONFIG.cache) } catch (e) { }

    logger.debug(`Finding all JSON files in ${CONFIG.trees} and all cache files in ${CONFIG.cache}.`);
    let tree_files = fs.readdirSync(CONFIG.trees).filter(f => f.match(/\.json$/));
    let files = fs.readdirSync(CONFIG.cache).filter(f => f.match(/\.topology$/));

    // Recherche des arbres qui n'existent pas dans le cache (donc à construire)
    logger.debug(`Searching missing trees in cache...`);
    tree_files = tree_files.filter(f => !files.includes(f.replace('.json', '.topology')));
    const missing = tree_files.length;

    logger.debug(`${missing} missing trees`);

    // Recherche des fichiers .topology à actualiser
    logger.debug(`Searching outdated cached trees...`);
    files = files
        .map(f => [f, fs.statSync(CONFIG.cache + f).mtime]) // Recherche le mtime de chaque fichier et renvoie un [name, date]
        .filter(f => (f[1] as Date).getTime() < (Date.now() - MAX_TIME)) // Gare si date_fichier < actuelle - temps max (temps max dépassé)
        .map(f => f[0] as string) // Renvoie uniquement le nom du fichier
        .map(f => f.replace('.topology', '.json')) // Transforme les fichiers *.topology en *.json
        .filter(f => { // Vérifie si le fichier associé existe
            if (!fs.existsSync(CONFIG.trees + f)) {
                logger.error(`File ${f} does not exists when rebuilding from cache. Has ${f.replace('.json', '.topology')} related tree changed name ?`);
                
                return false;
            }

            return true;
        });
    const outdated = files.length;

    files.push(...tree_files);

    if (files.length > 0) {
        logger.info(`${missing} missing tree${missing > 1 ? 's' : ''} in cache, ${outdated} outdated tree${outdated > 1 ? 's' : ''} has been detected. (Re)building...\n`);
        await rebuildTreesFrom(CONFIG, files);
    }
}
