"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const md5_1 = __importDefault(require("md5"));
const python_enumerate_1 = __importDefault(require("python-enumerate"));
class MDTree {
    constructor(append = true) {
        this.autoAppendable = true;
        this.data = {};
        this.md5 = MDTree.md5;
        this.autoAppendable = append;
    }
    static md5(str) {
        if (str in MDTree.mdCache) {
            return MDTree.mdCache[str];
        }
        return MDTree.mdCache[str] = md5_1.default(str);
    }
    get length() {
        let c = 0;
        for (const k1 in this.data)
            c += Object.keys(this.data[k1]).length;
        return c;
    }
    keys() {
        const set = new Set(Object.keys(this.data));
        for (const k in this.data) {
            for (const _k in this.data[k]) {
                set.add(_k);
            }
        }
        return set;
    }
    digest(k1, k2) {
        const _k1 = this.md5(k1);
        const _k2 = this.md5(k2);
        const x = _k1 < _k2 ? k1 : k2;
        const y = _k1 < _k2 ? k2 : k1;
        return [x, y];
    }
    append(k1, k2, datum) {
        if (!this.autoAppendable) {
            throw new TypeError("Cant append to custom leave");
        }
        const [x, y] = this.digest(k1, k2);
        this.push(x, y, datum);
    }
    getMaySet(x, y, value, force = false) {
        if (!(x in this.data)) {
            this.data[x] = {};
        }
        if (!(y in this.data[x]) || force) {
            this.data[x][y] = value;
        }
        return this.data[x][y];
    }
    remove(x, y) {
        if (!(x in this.data)) {
            return;
        }
        if (y in this.data[x]) {
            if (typeof this.data[x][y]["remove"] !== "undefined") {
                this.data[x][y]["remove"]();
            }
            delete this.data[x][y];
            if (Object.keys(this.data[x]).length === 0) {
                delete this.data[x];
            }
        }
    }
    push(x, y, datum) {
        const buf = this.getMaySet(x, y, []);
        buf.push(datum);
    }
    set(k1, k2, datum) {
        if (this.autoAppendable) {
            throw new TypeError("Can only override custom leave");
        }
        const [x, y] = this.digest(k1, k2);
        this.getMaySet(x, y, datum, true);
    }
    get(k1, k2) {
        const [x, y] = this.digest(k1, k2);
        if (!(x in this.data)) {
            return undefined;
        }
        return this.data[x][y];
    }
    getNode(k1) {
        const data = {};
        if (k1 in this.data) {
            for (const subk1 in this.data[k1]) {
                data[subk1] = this.data[k1][subk1];
            }
        }
        const _k1 = this.md5(k1);
        for (const k2 in this.data) {
            if (_k1 < this.md5(k2)) {
                continue;
            }
            if (k1 in this.data[k2]) {
                data[k2] = this.data[k2][k1];
            }
        }
        return data;
    }
    getOrSet(k1, k2, value) {
        const [x, y] = this.digest(k1, k2);
        return this.getMaySet(x, y, value);
    }
    exists(x) {
        return x in this.data;
    }
    testRef(x, y) {
        if (!(x in this.data)) {
            return false;
        }
        if (!(y in this.data[x])) {
            return false;
        }
        return true;
    }
    *[Symbol.iterator]() {
        for (const k1 in this.data) {
            for (const k2 in this.data[k1]) {
                yield [k1, k2, this.data[k1][k2]];
            }
        }
    }
    serialize() {
        return JSON.stringify({ data: this.data, append: true, version: 1 });
    }
    static from(serialized) {
        const tree = JSON.parse(serialized);
        const supported = [1];
        if (!supported.includes(tree.version)) {
            throw new Error("Unsupported MDTree version: " + tree.version);
        }
        const newobj = new MDTree(tree.append);
        newobj.data = tree.data;
        return newobj;
    }
}
MDTree.mdCache = {};
exports.MDTree = MDTree;
class DNTree extends MDTree {
    constructor() {
        super(...arguments);
        this.weights = {};
        this.rank_storage = {};
    }
    append(k1, k2, datum) {
        super.append(k1, k2, datum);
        for (const x of [k1, k2]) {
            if (!(x in this.weights)) {
                this.weights[x] = 0;
            }
            this.weights[x]++;
        }
    }
    getNode(k1) {
        // TODO TOCHECK
        const res = {};
        for (const [k2, v] of Object.entries(super.getNode(k1))) {
            if (this.rank[k1] < this.rank[k2]) {
                res[k2] = v;
            }
        }
        return res;
    }
    get rank() {
        if (Object.keys(this.rank_storage).length === 0) {
            const rank = Object.keys(this.weights).sort((a, b) => this.weights[b] - this.weights[a]);
            for (const [i, val] of python_enumerate_1.default(rank)) {
                this.rank_storage[val] = i;
            }
        }
        return this.rank_storage;
    }
    toString() {
        const res = {};
        [...super.keys()].forEach(k => { const d = this.getNode(k); if (d)
            res[k] = d; });
        return res;
    }
    getNonDense(k1) {
        return super.getNode(k1);
    }
}
exports.DNTree = DNTree;
