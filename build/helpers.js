"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const progress_1 = __importDefault(require("progress"));
const HomologyTree_1 = __importDefault(require("./HomologyTree"));
const OmegaTopology_1 = __importDefault(require("./OmegaTopology"));
/**
 * Create a new set that contains elements contained in current set and given set
 */
function setIntersection(current, other) {
    const set = new Set();
    for (const value of other) {
        if (current.has(value))
            set.add(value);
    }
    return set;
}
exports.setIntersection = setIntersection;
/**
 * Add every element in given iterables and the elements of the current set in a new set
 */
function setUnion(current, ...iterables) {
    const set = new Set(current);
    for (const it of iterables) {
        for (const value of it) {
            set.add(value);
        }
    }
    return set;
}
exports.setUnion = setUnion;
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
exports.escapeRegExp = escapeRegExp;
async function rebuildTreesFrom(CONFIG, files) {
    // Lecture des fichiers d'arbre à construire
    const topologies = [];
    for (const f of files) {
        console.log("Reading", f);
        const this_tree = new HomologyTree_1.default(CONFIG.trees + f);
        await this_tree.init();
        topologies.push(new OmegaTopology_1.default(this_tree));
    }
    console.log("Trees has been read, constructing graphes.\n");
    const total_length = topologies.reduce((previous, current) => {
        return previous + current.hDataLength;
    }, 0);
    const bar = new progress_1.default(":tree: :current partners of :total completed (:percent, :etas remaining)", total_length);
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
        fs_1.default.writeFileSync(CONFIG.cache + filename, t.serialize(false));
        console.log(`${files[i]}'s tree cache has been saved.`);
        i++;
    }
    console.log("Trees has been rebuilt.");
}
exports.rebuildTreesFrom = rebuildTreesFrom;
async function renewDatabase(nn, renew_partners, renew_lines) {
    if (renew_partners)
        await nn.db.destroy("id_map").then(() => nn.db.create("id_map"));
    if (renew_lines)
        await nn.db.destroy("interactors").then(() => nn.db.create("interactors"));
}
exports.renewDatabase = renewDatabase;
async function registerPairs(nn, pairs, max_paquet = 100) {
    const id_db = nn.use("id_map");
    const total = Object.keys(pairs).length;
    const bar = new progress_1.default(':current/:total :bar (:percent, :etas) ', { total, complete: "=", incomplete: " ", head: '>' });
    let promises = [];
    for (const id in pairs) {
        if (promises.length >= max_paquet) {
            await Promise.all(promises);
            promises = [];
        }
        promises.push(id_db.insert({ partners: pairs[id] }, id).then(() => bar.tick()));
    }
    await Promise.all(promises);
    bar.terminate();
}
exports.registerPairs = registerPairs;
async function registerLines(nn, pairs, max_paquet = 100) {
    const interactors = nn.use("interactors");
    const total = Object.keys(pairs).length;
    const bar = new progress_1.default(':current/:total :bar (:percent, :etas) ', { total, complete: "=", incomplete: " ", head: '>' });
    let promises = [];
    for (const id in pairs) {
        if (promises.length >= max_paquet) {
            await Promise.all(promises);
            promises = [];
        }
        let p = interactors.insert({ data: pairs[id] }, id).then(() => bar.tick());
        promises.push(p.catch(err => {
            console.warn("DB error:", err);
            // Attendre
            return new Promise(resolve => setTimeout(resolve, 500))
                .then(() => { console.log("Reinserting"); return interactors.insert({ data: pairs[id] }, id).then(() => bar.tick()); });
        }));
    }
    await Promise.all(promises);
    bar.terminate();
}
exports.registerLines = registerLines;
function countFileLines(filePath) {
    return new Promise((resolve, reject) => {
        let lineCount = 0;
        fs_1.default.createReadStream(filePath)
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
    });
}
exports.countFileLines = countFileLines;
