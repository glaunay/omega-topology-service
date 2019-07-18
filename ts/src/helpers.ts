import fs from 'fs';
import http from 'http';
import nano, { MaybeDocument } from 'nano';
import ProgressBar from 'progress';
import v8 from 'v8';
import OmegaTopology, { HomologyTree, PSICQuic } from 'omega-topology-fullstack';

export interface Config {
    trees: string, 
    mitab: string, 
    couchdb: string, 
    cache: string, 
    max_days_before_renew: number, 
    omegalomodb: string, 
    databases: { 
        partners: string, 
        mitab_lines: string 
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
        console.log("Reading", f);

        const this_tree = new HomologyTree(CONFIG.trees + f);
        await this_tree.init();
        topologies.push(new OmegaTopology(this_tree));
    }

    console.log("Trees has been read, constructing graphes.\n");

    const total_length = topologies.reduce((previous, current) => {
        return previous + current.hDataLength;
    }, 0);

    const bar = new ProgressBar(":tree: :current/:total completed (:percent, :etas remaining, :elapsed taken)", total_length);
    let i = 0;
    for (const t of topologies) {
        bar.tick(0, { tree: `Constructing ${files[i]}` });

        await t.init();

        await t.buildEdgesReverse(CONFIG.omegalomodb + "/bulk", bar);

        t.trimEdges({
            idPct: 25,
            simPct: 32,
            cvPct: 30,
            definitive: true,
            destroy_identical: true
        });

        i++;
    }

    bar.terminate();

    console.log("Saving trees to cache.");
    i = 0;
    try { fs.mkdirSync(CONFIG.cache) } catch (e) { }

    for (const t of topologies) {
        const filename = files[i].replace('.json', '.topology');
        fs.writeFileSync(CONFIG.cache + filename, t.serialize(false));

        console.log(`${files[i]}'s tree cache has been saved.`);
        i++;
    }

    console.log("Trees has been rebuilt.");
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
        await nn.db.destroy(CONFIG.databases.partners).catch(() => {});
    }
    if (renew_lines) {
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
export async function registerPairs(CONFIG: Config, nn: nano.ServerScope, pairs: { [id: string]: Iterable<string> }, max_paquet = 100) {
    const document_name = CONFIG.databases.partners;

    await nn.db.create(document_name).catch(() => {});

    const id_db = nn.use(document_name);

    const total = Object.keys(pairs).length;

    const bar = new ProgressBar(':current/:total :bar (:percent, :etas) ', { total, complete: "=", incomplete: " ", head: '>' });

    let promises: Promise<any>[] = [];

    const try_once = id => id_db.insert({ partners: pairs[id] } as MaybeDocument, id).then(() => bar.tick());

    for (const id in pairs) {
        if (promises.length >= max_paquet) {
            await Promise.all(promises);

            promises = [];
        }

        promises.push(
            try_once(id).catch(() => (new Promise(resolve => setTimeout(resolve, 50))).then(() => try_once)).catch(e => console.warn("Could not insert a line.", e))
        );
    }

    await Promise.all(promises);
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

    await nn.db.create(document_name).catch(() => {});

    const interactors = nn.use(document_name);

    const total = Object.keys(pairs).length;
    const bar = new ProgressBar(':current/:total :bar (:percent, :etas) ', { total, complete: "=", incomplete: " ", head: '>' });

    let promises: Promise<any>[] = [];
    for (const id in pairs) {
        if (promises.length >= max_paquet) {
            await Promise.all(promises);

            promises = [];
        }

        let p = interactors.insert({ data: pairs[id] } as MaybeDocument, id).then(() => bar.tick());

        promises.push(
            p.catch(() => {
                // console.warn("DB error:", err);
                // Attendre
                return new Promise(resolve => setTimeout(resolve, 500))
                    .then(() => interactors.insert({ data: pairs[id] } as MaybeDocument, id).then(() => bar.tick()))
                    .catch(e => console.warn("Could not insert a line.", e))
            })
        );
    }

    await Promise.all(promises);
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
    console.log(`Rebuilding ${with_partners ? "partners" : 'only'} ${with_lines ? (with_partners ? "and " : "") + "lines" : ''}.`);

    const nn = nano(CONFIG.couchdb);

    if (v8.getHeapStatistics().heap_size_limit < 5 * 1024 * 1024 * 1024) {
        console.error("Allocated memory is too low. Please use --max-old-space-size=8192");
    }

    // Reconstruction de la base de données
    const before_run = http.globalAgent.maxSockets;
    http.globalAgent.maxSockets = 200;

    // 1) Lecture du mitab entier (CONFIG.mitab)
    console.log("Reading global Mitab file");

    ////// TODO TOCHANGE : En stream, sans objet PSICQuic
    const psq = new PSICQuic(undefined, with_lines);
    let t = Date.now();
    await psq.read(CONFIG.mitab);
    console.log("Read completed in ", (Date.now() - t) / 1000, " seconds");

    // 2) Vidage de l'existant
    // & 3) Construction des documents (interactors et id_map)
    console.log("Recreate current database.");
    await renewDatabase(CONFIG, nn, with_partners, with_lines);

    if (with_partners) {
        // 4) Obtention des paires id => partners[]
        console.log("Getting partners");
        const pairs = psq.getAllPartnersPairs();

        // 5) Insertion des paires (peut être long)
        console.log("Inserting interactors partners in CouchDB");
        await registerPairs(CONFIG, nn, pairs, threads);
        console.log("Pairs has been successfully registered")
    }

    if (with_lines) {
        // 6) Obtention des objets id => { [partners]: lignes_liees[] }
        console.log("Getting raw lines to insert");
        const lines = psq.getAllLinesPaired();

        // 7) Insertion des lignes (peut être long)
        console.log("Inserting raw lines in CouchDB");
        await registerLines(CONFIG, nn, lines, threads)
        console.log("Lines has been successfully registered");

        console.log("Flushing PSICQuic object");
        psq.flushRaw();
    }

    console.log(`Rebuilding of the database is complete.`);
    
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

/**
 * Renew tree cache and create missing trees automatically.
 *
 * @param {Config} CONFIG
 */
export async function automaticCacheBuild(CONFIG: Config) {
    const MAX_TIME = 1000 * 60 * 60 * 24 * CONFIG.max_days_before_renew; // 15 jours par défaut

    try { fs.mkdirSync(CONFIG.cache) } catch (e) { }

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
