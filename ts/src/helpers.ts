import fs from 'fs';
import nano, { MaybeDocument } from 'nano';
import ProgressBar from 'progress';
import HomologyTree from './HomologyTree';
import OmegaTopology from './OmegaTopology';

export interface Config {
    trees: string, mitab: string, couchdb: string, cache: string, max_days_before_renew: number 
}

/**
 * Create a new set that contains elements contained in current set and given set
 */
export function setIntersection(current: Set<any>, other: Set<any>) {
    const set = new Set();

    for (const value of other) {
        if (current.has(value))
            set.add(value);
    }

    return set;
}

/**
 * Add every element in given iterables and the elements of the current set in a new set
 */
export function setUnion(current: Set<any>, ...iterables: Iterable<any>[]) {
    const set = new Set(current);

    for (const it of iterables) {
        for (const value of it) {
            set.add(value);
        }
    }

    return set;
}

export function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

export async function rebuildTreesFrom(CONFIG: Config, files: string[]) {
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

    const bar = new ProgressBar(":tree: :current partners of :total completed (:percent, :etas remaining)", total_length);
    let i = 0;
    for (const t of topologies) {
        bar.tick(0, { tree: `Constructing ${files[i]}` });
        i++;

        await t.init();

        await t.buildEdgesReverse(bar);

        t.definitiveTrim(30, 20, 30);
    }

    bar.terminate();

    console.log("Saving trees to cache.");
    i = 0;
    for (const t of topologies) {
        const filename = files[i].replace('.json', '.topology');
        fs.writeFileSync(CONFIG.cache + filename, t.serialize(false));

        console.log(`${files[i]}'s tree cache has been saved.`);
        i++;
    }

    console.log("Trees has been rebuilt.");
}

export async function renewDatabase(nn: nano.ServerScope, renew_partners: boolean, renew_lines: boolean) {
    if (renew_partners)
        await nn.db.destroy("id_map").then(() => nn.db.create("id_map"));

    if (renew_lines)
        await nn.db.destroy("interactors").then(() => nn.db.create("interactors"));
}

export async function registerPairs(nn: nano.ServerScope, pairs: { [id: string]: Iterable<string> }, max_paquet = 100) {
    const id_db = nn.use("id_map");

    const total = Object.keys(pairs).length;

    const bar = new ProgressBar(':current/:total :bar (:percent, :etas) ', { total, complete: "=", incomplete: " ", head: '>' });

    let promises: Promise<any>[] = [];
    for (const id in pairs) {
        if (promises.length >= max_paquet) {
            await Promise.all(promises);

            promises = [];
        }

        promises.push(
            id_db.insert({ partners: pairs[id] } as MaybeDocument, id).then(() => bar.tick())
        );
    }

    await Promise.all(promises);
    bar.terminate();
}

export async function registerLines(nn: nano.ServerScope, pairs: { [id: string]: { [coupledId: string]: string[] } }, max_paquet = 100) {
    const interactors = nn.use("interactors");

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
            p.catch(err => {
                console.warn("DB error:", err);
                // Attendre
                return new Promise(resolve => setTimeout(resolve, 500))
                    .then(() => { console.log("Reinserting"); return interactors.insert({ data: pairs[id] } as MaybeDocument, id).then(() => bar.tick()) })
            })
        );
    }

    await Promise.all(promises);
    bar.terminate();
}

export function countFileLines(filePath: string) {
    return new Promise((resolve, reject) => {
        let lineCount = 0;
        fs.createReadStream(filePath)
            .on("data", (buffer) => {
                let idx = -1;
                lineCount--; // Because the loop will run once for idx=-1
                do {
                    idx = buffer.indexOf(10, idx + 1);
                    lineCount++;
                } while (idx !== -1);
            }).on("end", () => {
                resolve(lineCount);
            }).on("error", reject);
    }) as Promise<number>;
}
