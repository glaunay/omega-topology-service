"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const http_1 = __importDefault(require("http"));
const nano_1 = __importDefault(require("nano"));
const progress_1 = __importDefault(require("progress"));
const v8_1 = __importDefault(require("v8"));
const omega_topology_fullstack_1 = __importStar(require("omega-topology-fullstack"));
const logger_1 = __importDefault(require("./logger"));
/**
 * Escape characters of a regular expression.
 *
 * @param {string} string
 * @returns {string}
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
exports.escapeRegExp = escapeRegExp;
/**
 * Rebuild tree cache from files array (filename, pointing to *.json trees)
 *
 * @param {Config} CONFIG
 * @param {string[]} files
 * @returns {Promise<void>}
 */
async function rebuildTreesFrom(CONFIG, files) {
    // Lecture des fichiers d'arbre à construire
    const topologies = [];
    for (const f of files) {
        logger_1.default.debug("Reading" + f);
        const this_tree = new omega_topology_fullstack_1.HomologyTree(CONFIG.trees + f);
        await this_tree.init();
        topologies.push(new omega_topology_fullstack_1.default(this_tree));
    }
    logger_1.default.info("Trees has been read, constructing graphes.\n");
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
    const bar = new progress_1.default(":tree: :current/:total completed (:percent, :etas remaining, :elapsed taken)", total_length);
    let i = 0;
    for (const t of topologies) {
        bar.tick(0, { tree: `Constructing ${files[i]}` });
        await t.init();
        await t.buildEdgesReverse(CONFIG.omegalomodb + "/bulk", bar);
        t.trimEdges(trim_parameters);
        i++;
    }
    bar.terminate();
    logger_1.default.verbose("Saving trees to cache.");
    i = 0;
    try {
        fs_1.default.mkdirSync(CONFIG.cache);
    }
    catch (e) { }
    for (const t of topologies) {
        const filename = files[i].replace('.json', '.topology');
        fs_1.default.writeFileSync(CONFIG.cache + filename, t.serialize(false));
        logger_1.default.verbose(`${files[i]}'s tree cache has been saved.`);
        i++;
    }
    logger_1.default.info("Trees has been rebuilt.");
}
exports.rebuildTreesFrom = rebuildTreesFrom;
/**
 * Empty the databases and recreate it.
 *
 * @param {nano.ServerScope} nn
 * @param {boolean} renew_partners
 * @param {boolean} renew_lines
 * @returns {Promise<void>}
 */
async function renewDatabase(CONFIG, nn, renew_partners, renew_lines) {
    if (renew_partners) {
        logger_1.default.debug(`Destroying partners database (${CONFIG.databases.partners})`);
        await nn.db.destroy(CONFIG.databases.partners).catch((e) => logger_1.default.error(e));
    }
    if (renew_lines) {
        logger_1.default.debug(`Destroying MI Tab lines database (${CONFIG.databases.mitab_lines})`);
        await nn.db.destroy(CONFIG.databases.mitab_lines).catch(() => { });
    }
}
exports.renewDatabase = renewDatabase;
/**
 * Register all the pairs in the CouchDB database
 *
 * @param {nano.ServerScope} nn
 * @param {{ [id: string]: Iterable<string> }} pairs
 * @param {number} [max_paquet=100]
 */
async function registerPairs(CONFIG, nn, pairs, max_paquet = 1000) {
    const document_name = CONFIG.databases.partners;
    logger_1.default.debug(`Creating database ${document_name}`);
    await nn.db.create(document_name).catch(() => { });
    const id_db = nn.use(document_name);
    const total = Object.keys(pairs).length;
    logger_1.default.debug(`${total} total pairs to insert`);
    const bar = new progress_1.default(':current/:total :bar (:percent, :etas) ', { total, complete: "=", incomplete: " ", head: '>' });
    const create_document = id => { return { _id: id, partners: pairs[id] }; };
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
exports.registerPairs = registerPairs;
/**
 * Register all the mitab lines in the CouchDB database
 *
 * @param {nano.ServerScope} nn
 * @param {{ [id: string]: { [coupledId: string]: string[] } }} pairs
 * @param {number} [max_paquet=100]
 */
async function registerLines(CONFIG, nn, pairs, max_paquet = 100) {
    const document_name = CONFIG.databases.mitab_lines;
    logger_1.default.debug(`Creating database ${document_name}`);
    await nn.db.create(document_name).catch(() => { });
    const interactors = nn.use(document_name);
    const total = Object.keys(pairs).length;
    logger_1.default.debug(`${total} total pairs to insert`);
    const bar = new progress_1.default(':current/:total :bar (:percent, :etas) ', { total, complete: "=", incomplete: " ", head: '>' });
    const create_document = id => { return { _id: id, data: pairs[id] }; };
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
exports.registerLines = registerLines;
/**
 * Rebuild from scratch the Couch database.
 *
 * @param {Config} CONFIG
 * @param {boolean} with_partners
 * @param {boolean} with_lines
 * @param {number} threads
 */
async function reconstructBDD(CONFIG, with_partners, with_lines, threads) {
    logger_1.default.info(`Rebuilding ${with_partners ? "partners" : 'only'} ${with_lines ? (with_partners ? "and " : "") + "lines" : ''}.`);
    logger_1.default.debug('Creating Nano Couch object');
    const nn = nano_1.default(CONFIG.couchdb);
    const heap_size = v8_1.default.getHeapStatistics().heap_size_limit;
    if (heap_size < 5 * 1024 * 1024 * 1024) {
        logger_1.default.error(`Allocated memory is too low (${(heap_size / (1024 * 1024)).toFixed(1)} Mo). Please use --max-old-space-size=8192`);
    }
    // Reconstruction de la base de données
    const before_run = http_1.default.globalAgent.maxSockets;
    http_1.default.globalAgent.maxSockets = 200;
    // 1) Lecture du mitab entier (CONFIG.mitab)
    logger_1.default.info("Reading global Mitab file");
    ////// TODO TOCHANGE : En stream, sans objet PSICQuic
    const psq = new omega_topology_fullstack_1.PSICQuic(undefined, with_lines);
    let t = Date.now();
    await psq.read(CONFIG.mitab);
    logger_1.default.verbose("Read completed in ", (Date.now() - t) / 1000, " seconds");
    // 2) Vidage de l'existant
    // & 3) Construction des documents (interactors et id_map)
    logger_1.default.info("Recreate current database.");
    await renewDatabase(CONFIG, nn, with_partners, with_lines);
    if (with_partners) {
        // 4) Obtention des paires id => partners[]
        logger_1.default.info("Getting partners");
        const pairs = psq.getAllPartnersPairs();
        // 5) Insertion des paires (peut être long)
        logger_1.default.info("Inserting interactors partners in CouchDB");
        await registerPairs(CONFIG, nn, pairs, threads);
        logger_1.default.verbose("Pairs has been successfully registered");
    }
    if (with_lines) {
        // 6) Obtention des objets id => { [partners]: lignes_liees[] }
        logger_1.default.debug("Getting raw lines to insert");
        const lines = psq.getAllLinesPaired();
        // 7) Insertion des lignes (peut être long)
        logger_1.default.info("Inserting raw lines in CouchDB");
        await registerLines(CONFIG, nn, lines, threads);
        logger_1.default.verbose("Lines has been successfully registered");
        logger_1.default.debug("Flushing PSICQuic object");
        psq.flushRaw();
    }
    logger_1.default.info(`Rebuilding of the database is complete.`);
    http_1.default.globalAgent.maxSockets = before_run;
}
exports.reconstructBDD = reconstructBDD;
/**
 * Rebuild all the tree cache using *.json files in CONFIG.trees
 * @export
 * @param {Config} CONFIG
 * @param {string} [specie]
 */
async function rebuildAllCache(CONFIG, specie) {
    // Vérifie que l'espèce existe dans les fichiers homologyTree
    logger_1.default.debug(`Searching JSON files in ${CONFIG.trees}`);
    let files = fs_1.default.readdirSync(CONFIG.trees).filter(f => f.match(/\.json$/));
    if (specie) {
        const escaped = escapeRegExp(specie);
        const match = new RegExp("^uniprot_" + escaped + "_homology\\.json$", "i");
        logger_1.default.info(`Looking for specie "${specie}" into "${CONFIG.trees}".`);
        const tree = files.find(e => match.test(e));
        if (!tree) {
            // aucune espèce ne correspond
            logger_1.default.error(`Any specie has matched "${specie}" while searching for homology trees. Exiting.`);
            return;
        }
        files = [tree];
    }
    await rebuildTreesFrom(CONFIG, files);
}
exports.rebuildAllCache = rebuildAllCache;
/**
 * Renew tree cache and create missing trees automatically.
 *
 * @param {Config} CONFIG
 */
async function automaticCacheBuild(CONFIG) {
    const MAX_TIME = 1000 * 60 * 60 * 24 * CONFIG.max_days_before_renew; // 15 jours par défaut
    try {
        fs_1.default.mkdirSync(CONFIG.cache);
    }
    catch (e) { }
    logger_1.default.debug(`Finding all JSON files in ${CONFIG.trees} and all cache files in ${CONFIG.cache}.`);
    let tree_files = fs_1.default.readdirSync(CONFIG.trees).filter(f => f.match(/\.json$/));
    let files = fs_1.default.readdirSync(CONFIG.cache).filter(f => f.match(/\.topology$/));
    // Recherche des arbres qui n'existent pas dans le cache (donc à construire)
    logger_1.default.debug(`Searching missing trees in cache...`);
    tree_files = tree_files.filter(f => !files.includes(f.replace('.json', '.topology')));
    const missing = tree_files.length;
    logger_1.default.debug(`${missing} missing trees`);
    // Recherche des fichiers .topology à actualiser
    logger_1.default.debug(`Searching outdated cached trees...`);
    files = files
        .map(f => [f, fs_1.default.statSync(CONFIG.cache + f).mtime]) // Recherche le mtime de chaque fichier et renvoie un [name, date]
        .filter(f => f[1].getTime() < (Date.now() - MAX_TIME)) // Gare si date_fichier < actuelle - temps max (temps max dépassé)
        .map(f => f[0]) // Renvoie uniquement le nom du fichier
        .map(f => f.replace('.topology', '.json')) // Transforme les fichiers *.topology en *.json
        .filter(f => {
        if (!fs_1.default.existsSync(CONFIG.trees + f)) {
            logger_1.default.error(`File ${f} does not exists when rebuilding from cache. Has ${f.replace('.json', '.topology')} related tree changed name ?`);
            return false;
        }
        return true;
    });
    const outdated = files.length;
    files.push(...tree_files);
    if (files.length > 0) {
        logger_1.default.info(`${missing} missing tree${missing > 1 ? 's' : ''} in cache, ${outdated} outdated tree${outdated > 1 ? 's' : ''} has been detected. (Re)building...\n`);
        await rebuildTreesFrom(CONFIG, files);
    }
}
exports.automaticCacheBuild = automaticCacheBuild;
