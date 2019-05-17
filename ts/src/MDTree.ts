import md5 from 'md5';
import enumerate from 'python-enumerate';

export interface MDNode<T> {
    [nodeId: string]: T;
}

export class MDTree<T> {
    public autoAppendable = true;
    protected data: { [id: string]: { [secondId: string]: T } } = {};
    protected static mdCache: { [str: string]: string } = {};
    protected md5 = MDTree.md5;

    constructor(append = true) {
        this.autoAppendable = append;
    }

    static md5(str: string) {
        if (str in MDTree.mdCache) {
            return MDTree.mdCache[str];
        }
        return MDTree.mdCache[str] = md5(str);
    }

    get length() : number {
        let c = 0;

        for (const k1 in this.data)
            c += Object.keys(this.data[k1]).length;
        
        return c;
    }

    public keys() : Set<string> {
        const set = new Set(Object.keys(this.data));

        for (const k in this.data) {
            for (const _k in this.data[k]) {
                set.add(_k);
            }
        }

        return set;
    }

    protected digest(k1: string, k2: string) : [string, string] {
        const _k1 = this.md5(k1);
        const _k2 = this.md5(k2);

        const x = _k1 < _k2 ? k1 : k2;
        const y = _k1 < _k2 ? k2 : k1;

        return [x, y];
    }

    public append(k1: string, k2: string, datum: T) : void {
        if (!this.autoAppendable) {
            throw new TypeError("Cant append to custom leave");
        }

        const [x, y] = this.digest(k1, k2);
        this.push(x, y, datum);
    }

    protected getMaySet(x: string, y: string, value: T, force = false) {
        if (!(x in this.data)) {
            this.data[x] = {};
        }

        if (!(y in this.data[x]) || force) {
            this.data[x][y] = value;
        }

        return this.data[x][y];
    }

    public remove(x: string, y: string) : void {
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

    protected push(x: string, y: string, datum: T) : void {
        const buf = this.getMaySet(x, y, [] as unknown as T);
        (buf as unknown as any[]).push(datum);
    }

    public set(k1: string, k2: string, datum: T) : void {
        if (this.autoAppendable) {
            throw new TypeError("Can only override custom leave");
        }

        const [x, y] = this.digest(k1, k2);
        this.getMaySet(x, y, datum, true);
    }

    public get(k1: string, k2: string) {
        const [x, y] = this.digest(k1, k2);

        if (!(x in this.data)) {
            return undefined;
        }

        return this.data[x][y];
    }

    public getNode(k1: string) : MDNode<T> {
        const data: MDNode<T> = {};

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

    public getOrSet(k1: string, k2: string, value: T) {
        const [x, y] = this.digest(k1, k2);
        return this.getMaySet(x, y, value);
    }

    public exists(x: string) {
        return x in this.data;
    }

    protected testRef(x: string, y: string) {
        if (!(x in this.data)) {
            return false;
        }

        if (!(y in this.data[x])) {
            return false;
        }

        return true;
    }

    public *[Symbol.iterator]() : IterableIterator<[string, string, T]> {
        for (const k1 in this.data) {
            for (const k2 in this.data[k1]) {
                yield [k1, k2, this.data[k1][k2]];
            }
        }
    }

    serialize() : string {
        return JSON.stringify({ data: this.data, append: true, version: 1 });
    }

    static from(serialized: string) : MDTree<any> {
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

export class DNTree<T> extends MDTree<T> {
    public weights: { [id: string]: number } = {};
    protected rank_storage: { [rankName: string]: number } = {};

    append(k1: string, k2: string, datum: T) {
        super.append(k1, k2, datum);

        for (const x of [k1, k2]) {
            if (!(x in this.weights)) {
                this.weights[x] = 0;
            }
            this.weights[x]++;
        }
    }

    getNode(k1: string) {
        // TODO TOCHECK
        const res: { [k: string]: T } = {};
        
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

            for (const [i, val] of enumerate(rank)) {
                this.rank_storage[val] = i;
            }
        }

        return this.rank_storage;
    }

    toString() {
        const res: { [k: string]: MDNode<T> } = {};
        [...super.keys()].forEach(k => { const d = this.getNode(k); if (d) res[k] = d; });

        return res;
    }

    getNonDense(k1: string) {
        return super.getNode(k1);
    }
}
