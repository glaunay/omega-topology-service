import zip from "python-zip";

export type HVector = string[];

export class HoParameterSet {
    public lowQueryParam: HoParameter[] = [];
    public highQueryParam: HoParameter[] = [];
    public visible = true;

    toString() {
        return JSON.stringify({
            lowQueryParam: this.lowQueryParam.filter(e => e.valid),
            highQueryParam: this.highQueryParam.filter(e => e.valid)
        });
    }

    remove() {
        this.lowQueryParam = [];
        this.highQueryParam = [];
        this.visible = false;
    }

    get depth() {
        return this.length;
    }

    get length() {
        return this.lowQueryParam.filter(e => e.valid).length;
    }

    get isEmpty() {
        return this.length === 0;
    }

    get templates() {
        return [
            this.lowQueryParam.filter(e => e.valid).map(e => e.template),
            this.highQueryParam.filter(e => e.valid).map(e => e.template)
        ];
    }

    add(x: HVector, y: HVector) {
        this.lowQueryParam.push(new HoParameter(x));
        this.highQueryParam.push(new HoParameter(y));
    }

    trim(simPct = 0, idPct = 0, cvPct = 0, eValue = 1, definitive = false) {
        this.visible = true;

        const to_remove = [];
        let i = 0;
        for (const [loHparam, hiHparam] of this) {
            loHparam.valid = loHparam.simPct >= simPct && loHparam.idPct >= idPct && loHparam.cvPct >= cvPct && loHparam.eValue <= eValue;
            hiHparam.valid = hiHparam.simPct >= simPct && hiHparam.idPct >= idPct && hiHparam.cvPct >= cvPct && hiHparam.eValue <= eValue;;

            if (!loHparam.valid || !hiHparam.valid) {
                loHparam.valid = hiHparam.valid = false;
                to_remove.push(i);
            }
            i++;
        }

        if (definitive) {
            this.lowQueryParam = this.lowQueryParam.filter((_, index) => !to_remove.includes(index));
            this.highQueryParam = this.highQueryParam.filter((_, index) => !to_remove.includes(index));
        }
    }

    *[Symbol.iterator]() : IterableIterator<[HoParameter, HoParameter]> {
        for (const values of zip(this.lowQueryParam, this.highQueryParam)) {
            yield values as [HoParameter, HoParameter];
        }
    }
}

export class HoParameter {
    public data: HVector;
    public valid = true;

    constructor(hVector: HVector) {
        this.data = hVector;
    }

    get length() : number {
        return parseInt(this.data[3]) - parseInt(this.data[2]) + 1;
    }

    get template() {
        return this.data[0];
    }

    get simPct() {
        return 100 * Number(this.data[7]) / this.length;
    }

    get idPct() {
        return 100 * Number(this.data[8]) / this.length;
    }

    get cvPct() {
        return 100 * this.length / parseInt(this.data[1]);
    }

    get eValue() {
        return Number(this.data[9]);
    }
}