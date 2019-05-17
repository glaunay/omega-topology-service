import fs from 'fs';
import nano, { MaybeDocument } from 'nano';
import ProgressBar from 'progress';

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

export function rebuildTreesFrom(files: string[]) {
    for (const f of files) { }
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
