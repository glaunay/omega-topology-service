import nano from 'nano';
export interface Config {
    /** Trees directory. Must contains only .json homology trees. */
    trees: string;
    /** MI Tab file (common for all species) */
    mitab: string;
    /** CouchDB database URL (with port) */
    couchdb: string;
    /** Cache directory. MUST be created. Where the cached skeletons will be stored. */
    cache: string;
    /** Maximum days until auto cache renew. */
    max_days_before_renew: number;
    /** omegalomodb request agregator URL */
    omegalomodb: string;
    /** Database names, where the MI Tab file will be stored into CouchDB. */
    databases: {
        /** Interactors couples. { [id1: string]: ListOfInteractorsIdOfId1<string> } */
        partners: string;
        /** Interactors couples, with MI Tab lines. { [id1: string]: { [interactorId: string]: ListOfMitabLinesOf[Id1:interactorId]Interaction<string> } }  */
        mitab_lines: string;
    };
    /** On skeleton construct, parameters that will be transmitted
     * to the `trimEdges` method of the OmegaToplogy object.
     * False mean no parameter. */
    auto_trim: false | {
        idPct: number;
        simPct: number;
        cvPct: number;
    };
}
/**
 * Escape characters of a regular expression.
 *
 * @param {string} string
 * @returns {string}
 */
export declare function escapeRegExp(string: string): string;
/**
 * Rebuild tree cache from files array (filename, pointing to *.json trees)
 *
 * @param {Config} CONFIG
 * @param {string[]} files
 * @returns {Promise<void>}
 */
export declare function rebuildTreesFrom(CONFIG: Config, files: string[]): Promise<void>;
/**
 * Empty the databases and recreate it.
 *
 * @param {nano.ServerScope} nn
 * @param {boolean} renew_partners
 * @param {boolean} renew_lines
 * @returns {Promise<void>}
 */
export declare function renewDatabase(CONFIG: Config, nn: nano.ServerScope, renew_partners: boolean, renew_lines: boolean): Promise<void>;
/**
 * Register all the pairs in the CouchDB database
 *
 * @param {nano.ServerScope} nn
 * @param {{ [id: string]: Iterable<string> }} pairs
 * @param {number} [max_paquet=100]
 */
export declare function registerPairs(CONFIG: Config, nn: nano.ServerScope, pairs: {
    [id: string]: Iterable<string>;
}, max_paquet?: number): Promise<void>;
/**
 * Register all the mitab lines in the CouchDB database
 *
 * @param {nano.ServerScope} nn
 * @param {{ [id: string]: { [coupledId: string]: string[] } }} pairs
 * @param {number} [max_paquet=100]
 */
export declare function registerLines(CONFIG: Config, nn: nano.ServerScope, pairs: {
    [id: string]: {
        [coupledId: string]: string[];
    };
}, max_paquet?: number): Promise<void>;
/**
 * Rebuild from scratch the Couch database.
 *
 * @param {Config} CONFIG
 * @param {boolean} with_partners
 * @param {boolean} with_lines
 * @param {number} threads
 */
export declare function reconstructBDD(CONFIG: Config, with_partners: boolean, with_lines: boolean, threads: number): Promise<void>;
/**
 * Rebuild all the tree cache using *.json files in CONFIG.trees
 * @export
 * @param {Config} CONFIG
 * @param {string} [specie]
 */
export declare function rebuildAllCache(CONFIG: Config, specie?: string): Promise<void>;
/**
 * Renew tree cache and create missing trees automatically.
 *
 * @param {Config} CONFIG
 */
export declare function automaticCacheBuild(CONFIG: Config): Promise<void>;
