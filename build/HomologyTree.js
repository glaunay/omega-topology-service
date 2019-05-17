"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
/**
 * Permet de lire un arbre d'homologie (tel Homology_R6.json) au format JSON.
 *
 */
class HomologTree {
    constructor(filename) {
        this.data = {};
        if (!filename) {
            this.init_promise = Promise.resolve();
        }
        else {
            this.init_promise = new Promise((resolve, reject) => {
                fs_1.default.readFile(filename, { encoding: 'utf-8' }, (err, data) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    // Parse le JSON, l'enregistre dans this.data 
                    // et résoud la promesse sans aucune donnée
                    resolve(void (this.data = JSON.parse(data)));
                });
            });
        }
    }
    /**
     * Promise symbolizing instance state
     */
    init() {
        return this.init_promise;
    }
    getChildrenData(psqId) {
        if (!(psqId in this.data)) {
            return {};
        }
        const result = {};
        for (const homologKey in this.data[psqId]) {
            result[homologKey] = [psqId];
            const hVector = this.data[psqId][homologKey][0]; // Tableau de résultat blast (ne prend que le premier)
            for (const e of hVector) {
                result[homologKey].push(e);
            }
        }
        return result;
    }
    serialize() {
        return JSON.stringify({ data: this.data, version: 1 });
    }
    get length() {
        return Object.keys(this.data).length;
    }
    static from(serialized) {
        const newobj = new HomologTree("");
        const homolog_data = JSON.parse(serialized);
        const supported = [1];
        if (!supported.includes(homolog_data.version)) {
            throw new Error("Unsupported HomologTree version: " + homolog_data.version);
        }
        newobj.data = homolog_data.data;
        return newobj;
    }
    *[Symbol.iterator]() {
        yield* Object.keys(this.data);
    }
}
exports.default = HomologTree;
