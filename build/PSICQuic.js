"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const reversible_key_map_1 = __importDefault(require("reversible-key-map"));
const PSICQuicData_1 = require("./PSICQuicData");
const readline_1 = __importDefault(require("readline"));
const fs_1 = __importDefault(require("fs"));
const helpers_1 = require("./helpers");
const progress_1 = __importDefault(require("progress"));
class PSICQuic {
    constructor(mode = "LOOSE", keep_raw = false, offline = true) {
        this.mode = mode;
        this.keep_raw = keep_raw;
        // public static web = new OLS;
        this.records = new reversible_key_map_1.default();
        this.registredPublications = {};
        // public registry = new Registry;
        this.init_promise = Promise.resolve();
        /* if (!offline) { registryUrl = "http://www.ebi.ac.uk/Tools/webservices/psicquic/registry/registry?action=STATUS&format=xml"
            this.init_promise = this.getRegistry(registryUrl)
                .then(r => {
                    this.registry = r;

                    if (!this.registry) {
                        this.registry = new Registry;
                    }
                })
                .catch(() => {
                    this.registry = new Registry;
                });
        } */
    }
    init() {
        return this.init_promise;
    }
    readLines(str) {
        if (typeof str === 'string') {
            str = str.split('\n');
        }
        const added_psq = [];
        for (const line of str) {
            this.parseLine(line, added_psq);
        }
        return added_psq;
    }
    async read(file, with_progress = true) {
        let lineCount = 0;
        if (with_progress)
            lineCount = await helpers_1.countFileLines(file);
        let lineNr = 0;
        let bar = undefined;
        if (with_progress)
            bar = new progress_1.default(':current/:total :bar (:percent, :etas) ', { total: lineCount + 1, complete: "=", incomplete: " ", head: '>' });
        return new Promise(resolve => {
            const lineReader = readline_1.default.createInterface({
                input: fs_1.default.createReadStream(file)
            });
            lineReader.on('line', (line) => {
                lineNr += 1;
                if (bar)
                    bar.tick();
                this.parseLine(line);
            });
            lineReader.on("close", () => {
                if (bar)
                    bar.terminate();
                else
                    console.log('Read entire file. (' + lineNr + ') lines');
                resolve();
            });
        });
    }
    static bulkGetWrap(ids) {
        return { docs: ids.map(id => { id; }) };
    }
    clone() {
        const newclone = new PSICQuic;
        newclone.records = this.records;
    }
    plus(other) {
        for (const [, value] of other.records) {
            for (const line of value) {
                if (this.checkPsqData(line)) {
                    this.update(line);
                }
            }
        }
        return [].concat(...this.records.values());
    }
    checkPsqData(psqDataObj) {
        const pmid = psqDataObj.pmid;
        const source = psqDataObj.source.toLowerCase();
        if (!(pmid in this.registredPublications)) {
            this.registredPublications[pmid] = source;
            console.log("Putting " + source + ' in ' + this.registredPublications[pmid]);
            console.log(psqDataObj);
            return true;
        }
        if (this.registredPublications[pmid] == source) {
            return true;
        }
        else {
            console.log("Warning publication " + pmid + " provided by " + source + " has already been fetched from " + this.registredPublications[pmid]);
            console.log(psqDataObj);
            return false;
        }
    }
    get length() {
        return this.records.size;
    }
    toString() {
        return [...this.records.values()].map(e => e.toString()).join("\n");
    }
    get [Symbol.toStringTag]() {
        return "PSICQuic";
    }
    getByIndex(i) {
        return [].concat(...this.records.values())[i];
    }
    has(id) {
        return this.records.has(id);
    }
    hasCouple(id1, id2) {
        return this.records.hasCouple(id1, id2);
    }
    get(id) {
        if (this.has(id)) {
            return [].concat(...this.records.getAllFrom(id).values());
        }
        return [];
    }
    getLines(id1, id2) {
        if (this.hasCouple(id1, id2)) {
            return this.records.get(id1, id2);
        }
        return [];
    }
    update(psq) {
        const [id1, id2] = psq.ids;
        const actual_array = this.getLines(id1, id2);
        // Check if line already exists
        if (actual_array.every(line => !line.equal(psq))) {
            actual_array.push(psq);
            this.records.set(id1, id2, actual_array);
        }
    }
    *[Symbol.iterator]() {
        for (const lines of this.records.values()) {
            yield* lines;
        }
    }
    *couples() {
        for (const [keys, lines] of this.records) {
            yield [keys[0], keys[1], lines];
        }
    }
    getAllPartnersPairs() {
        const couples = {};
        for (const [keys,] of this.records) {
            const [id1, id2] = keys;
            if (id1 in couples)
                couples[id1].add(id2);
            else
                couples[id1] = new Set([id2]);
            if (id2 in couples)
                couples[id2].add(id1);
            else
                couples[id2] = new Set([id1]);
        }
        for (const key in couples) {
            // Transformation en tableau
            couples[key] = [...couples[key]];
        }
        return couples;
    }
    getAllLinesPaired() {
        const couples = {};
        for (const [keys, values] of this.records) {
            const [id1, id2] = keys;
            if (!(id1 in couples)) {
                couples[id1] = {};
            }
            if (!(id2 in couples)) {
                couples[id2] = {};
            }
            couples[id2][id1] = couples[id1][id2] = values.map(v => v.raw);
        }
        return couples;
    }
    flushRaw() {
        this.keep_raw = false;
        for (const psqData of this) {
            psqData.raw = undefined;
        }
    }
    clear() {
        this.records.clear();
        this.registredPublications = {};
    }
    json(filename) {
        let str = '{"type" : "mitabResult", "data" : [' + [...this].map(e => e.json).join(',') + '] }';
        if (filename && process) {
            fs_1.default.writeFileSync(filename, str);
        }
        return str;
    }
    dump(filename) {
        if (filename) {
            fs_1.default.writeFileSync(filename, this.toString());
        }
        return this.toString();
    }
    parse(buffer, encoder) {
        for (const line of buffer) {
            if (line.length === 0 || line.startsWith('#')) {
                continue;
            }
            // ignoring encoder in JS
            this.update(new PSICQuicData_1.PSQData(line, this.keep_raw));
        }
    }
    parseLine(line, added) {
        if (line.length === 0 || line.startsWith('#')) {
            return;
        }
        const d = new PSICQuicData_1.PSQData(line, this.keep_raw);
        if (added)
            added.push(d);
        this.update(d);
    }
    countPmid() {
        return new Set([...this].map(e => e.pmid));
    }
    topology(type = "uniprotID") {
        const nodes = new Set();
        const edges = new Map();
        // call this.@@iterator
        for (const p of this) {
            const t = p.uniprotPair;
            if (!t) {
                continue;
            }
            t.forEach(n => nodes.add(n));
            const arr = edges.get(t);
            if (arr) {
                arr.push(p);
            }
            else {
                edges.set(t, [p]);
            }
        }
        return [nodes, edges];
    }
    getBiomolecules(type = 'uniprot') {
        if (type === 'uniprot') {
            let l = [];
            for (const p of this) {
                console.log(p);
                const up = p.uniprotPair;
                if (up) {
                    l = l.concat(up);
                }
            }
            return [...new Set(l)];
        }
    }
    filter(uniprot = [], predicate) {
        const target = new PSICQuic(undefined, undefined, true);
        if (uniprot.length) {
            const buffer = new Set(uniprot);
            for (const data of this) {
                let up = data.uniprotPair;
                if (!up) {
                    continue;
                }
                up = new Set(up);
                if (helpers_1.setIntersection(up, buffer).size) {
                    target.records[data.hash] = data;
                }
            }
        }
        if (predicate) {
            for (const data of this) {
                if (predicate(data))
                    target.records[data.hash] = data;
            }
        }
        return target;
    }
}
PSICQuic.mitabLvls = ["25", "27"];
exports.default = PSICQuic;
