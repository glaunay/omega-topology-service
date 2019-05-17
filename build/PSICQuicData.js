"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const md5_1 = __importDefault(require("md5"));
const python_zip_1 = __importDefault(require("python-zip"));
class PSQData {
    constructor(raw, keep_raw = false) {
        this.data = raw.split(/\t+/g).filter(str => str.trim().length > 0).map(str => new PSQDatum(str));
        this.hash = md5_1.default(raw);
        if (keep_raw) {
            this.raw = raw;
        }
        if (this.data.length !== 15 && this.data.length !== 42) {
            // for (const [i, e] of enumerate(this.data)) {
            //     console.log(`[${i}] ${e}`);
            // }
            throw new Error("Uncorrect number of tabulated fields on input [" + this.data.length + "] at:\n" + raw);
        }
    }
    get ids() {
        return [this.data[0].value.split(':', 2).pop(), this.data[1].value.split(':', 2).pop()];
    }
    equal(other) {
        return this.hash === other.hash;
    }
    toString() {
        return this.data.map(e => e.toString()).join("\t");
    }
    get [Symbol.toStringTag]() {
        return "PSQData";
    }
    get taxid() {
        return [this.data[9].content[0][1], this.data[10].content[0][1]];
    }
    get pmid() {
        for (const field of this.data[8].data) {
            if (field.type === "pubmed:") {
                return field.value;
            }
        }
        return this.data[8].data[0].value;
    }
    get source() {
        return this.data[12].data[0].annotation ? this.data[12].data[0].annotation : this.data[12].data[0].value;
    }
    get interactionDetectionMethod() {
        return this.data[6].data[0].value;
    }
    get species() {
        return [this.data[9].data[0].value, this.data[10].data[0].value];
    }
    uniprotCapture(str) {
        const subString = str ? str.match(/[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}/) : undefined;
        if (subString)
            return subString[0];
        return undefined;
    }
    get uniprotPair() {
        const a = this.uniprotCapture(this.data[0].data[0].value) ? this.uniprotCapture(this.data[0].data[0].value) : this.uniprotCapture(this.data[2].data[0].value);
        const b = this.uniprotCapture(this.data[1].data[0].value) ? this.uniprotCapture(this.data[1].data[0].value) : this.uniprotCapture(this.data[3].data[0].value);
        if (a && b) {
            return b < a ? [b, a] : [a, b];
        }
        return undefined;
    }
    get json() {
        const obj = {};
        for (const [k, d] of python_zip_1.default(PSQData.PSQ_FIELDS, this.data)) {
            obj[k] = d.toString();
        }
        return JSON.stringify(obj);
    }
    get interactors() {
        return [this.data[0].content.concat(this.data[2].content), this.data[1].content.concat(this.data[3].content)];
    }
    swapInteractors(to, iSlot) {
        let consideredSlots = [0, 1];
        if (iSlot) {
            consideredSlots = [['A', 'B'].indexOf(iSlot)];
            if (consideredSlots[0] === -1) {
                console.error("If you specify a slot to swap interactors, it must be A or B");
                return;
            }
        }
        for (const i of consideredSlots) {
            const psqDatum = this.data[i];
            const alt = this.data[i + 2];
            for (const [iField, cPsq] of alt.entries()) {
                if (cPsq.value === to) {
                    const _anon = cPsq;
                    alt.data[iField] = psqDatum.data[0];
                    psqDatum.data[0] = _anon;
                    break;
                }
            }
        }
    }
    hasInteractors(mode = 'STRICT') {
        //// TODO
        return false;
    }
    getNames() {
        // TODO
    }
    getPartners() {
        // TODO
        // Ask for partners
        // Extract uniprot id
        // fill a 'p->{ m_0, m_1, ..., m_n,}, where m's are uniprot match
    }
}
PSQData.PSQ_FIELDS = ["idA", "idB", "altA", "altB", "aliasA", "aliasB", "interactionDetectionMethod", "firstAuthor", "pubid", "taxidA", "taxidB",
    "interactionTypes", "sourceDatabases", "interactionIdentifiers", "confidenceScore", "complexExpansion", "biologicalRoleA",
    "biologicalRoleB", "experimentalRoleA", "experimentalRoleB", "interactorTypeA", "interactorTypeB", "xRefA", "xRefB",
    "xRefInteraction", "annotationA", "annotationB", "annotationInteraction", "taxidHost", "parameters", "creationDate",
    "updateDate", "checksumA", "checksumB", "negative", "featuresA", "featuresB", "stoichiometryA", "stoichiometryB",
    "identificationMethodA", "identificationMethodB"];
exports.PSQData = PSQData;
class PSQDatum {
    constructor(colomn) {
        this.data = colomn.split('|').map(e => new PSQField(e));
    }
    equal(datum) {
        for (const [d1, d2] of python_zip_1.default(this.data, datum.data)) {
            if (!d1.equal(d2)) {
                return false;
            }
        }
        return true;
    }
    toString() {
        return this.data.map(e => e.toString()).join('|');
    }
    get [Symbol.toStringTag]() {
        return "PSQDatum";
    }
    *[Symbol.iterator]() {
        yield* this.data;
    }
    *entries() {
        let i = 0;
        for (const e of this) {
            yield [i, e];
        }
    }
    at(key) {
        return [...this].filter(e => e.type === key + ":").map(e => e.value);
    }
    get content() {
        return [...this].map(e => [e.type, e.value]);
    }
    get value() {
        return this.data.map(e => e.value).join('|');
    }
}
exports.PSQDatum = PSQDatum;
class PSQField {
    constructor(element) {
        const m = PSQField.fieldParser.exec(element);
        // this.raw = element;
        if (m) {
            this.type = m[1];
            this.value = m[2];
            this.annotation = m[3];
        }
        else {
            this.value = element;
            this.type = undefined;
            this.annotation = undefined;
        }
    }
    equal(field) {
        return this.value === field.value && this.type === field.type && this.annotation === field.annotation;
    }
    toString() {
        return "";
        // return this.raw;
    }
    get [Symbol.toStringTag]() {
        return "PSQField";
    }
}
PSQField.fieldParser = /^([^:^"]+:){0,1}"{0,1}([^"\(]+)"{0,1}\({0,1}([^\)]+){0,1}\){0,1}$/;
exports.PSQField = PSQField;
