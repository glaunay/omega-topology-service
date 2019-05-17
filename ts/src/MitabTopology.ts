import { PSQData } from "./PSICQuicData";
import PSICQuic from "./PSICQuic";

////// Cette instance est destinée à tourner chez un client. L'utilité pour le service est moindre (reconstruction).

export class MitabTopology {
    protected psiq: PSICQuic;

    constructor(psqObject: PSICQuic) {
        this.psiq = psqObject;
    }

    keys() {
        return this.psiq.records.keys();
    }

    public *[Symbol.iterator]() {
        yield* this.psiq.couples();
    }

    get length() {
        return this.psiq.length;
    }

    get(k1: string) {
        return this.psiq.get(k1);
    }

    get [Symbol.toStringTag]() {
        return "MitabTopology";
    }
}

export default class LocalMitab extends MitabTopology {
    protected empty_nodes = new Set;
    protected _remaining = 0;
    protected _dls = 0;

    protected cache = {};

    constructor(protected url: string, protected couple_url: string) {
        super(new PSICQuic);
    }

    async fetch(k1: string) {
        if (this.empty_nodes.has(k1)) {
            return undefined;
        }

        const node = this.get(k1);
        if (Object.keys(node).length === 0) {
            // Le noeud n'existe pas. On fetch !
            const lines: string[] = await this.getMitabLines(k1);

            this.psiq.readLines(lines);
        }
        else {
            // Récupérer les données mitab existantes pour K1
            return node;
        }
    }

    async fetchCouple(k1: string, k2: string) {
        const node = await this.fetch(k1);

        if (Object.keys(node).length === 0) {
            // Ce noeud est vide, il faut le marquer
            this.empty_nodes.add(k1);
        }

        // On recherche si le couple existe
        if (k2 in node) {
            return node[k2];
        }
        // Sinon, l'association n'existe pas

        return undefined;
    }

    async getMitabLines(k1: string, k2?: string) {
        // Get lines for ONE interactors (all corresponding lines) if k2 = undefined
        // else: Get lines holding k1 & k2
        const do_request = async () => {
            // On les récupère
            const partners = await fetch(this.url, {
                method: "POST",
                body: JSON.stringify({ keys: [k1] }),
                headers: { "Content-Type": "application/json" }
            }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)));

            const result = partners.request[0];

            return result as { id: string, data: { [partnerId: string]: string[] } };
        };

        const ids = await do_request();

        if (Object.keys(ids).length > 0) {
            if (!k2) {
                // Renvoie toutes les lignes associées à k1
                return [].concat(...Object.values(ids.data)) as string[];
            }

            if (k2 in ids.data) {
                return ids.data[k2];
            }
        }
        else {
            return [];
        }
    }

    async getTemplatePairs(pairs: [string, string][]) : Promise<void> {
        this._remaining = pairs.length;

        await this.bulkForEach(
            pairs,
            lines => {
                this._remaining -= lines.length;
                this._dls += lines.length;
                return lines;
            }
        );

        this._dls = pairs.length;
        this._remaining = 0;
    }

    get remaining() {
        return this._remaining;
    }

    get downloaded() {
        return this._dls;
    }

    protected async bulkForEach(
        ids: Iterable<[string, string]>, 
        cb: (lines: PSQData[][]) => PSQData[][], 
        packet_len = 128
    ) {
        let cache: [string, string][] = [];

        const do_request = async () => {
            // On les récupère
            const partners = await fetch(this.couple_url, {
                method: "POST",
                body: JSON.stringify({ keys: cache }),
                headers: { "Content-Type": "application/json" }
            }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)));

            const result_array = partners.request as { [key1_key2: string]: string[] };
            
            const return_obj: [[string, string], string[]][] = [];
            for (const id_map in result_array) {
                const bothids = id_map.split('~', 2) as [string, string];
                return_obj.push([bothids, result_array[id_map]]);
            }

            // Add every line in psq
            const final_psq: PSQData[][] = [];
            for (const [, lines] of return_obj) {
                final_psq.push(this.psiq.readLines(lines));
            }

            return final_psq;
        };

        const promises: Promise<PSQData[][]>[] = [];
        const dl_lines: PSQData[][] = [];

        // Parcours de l'itérable
        for (const id of ids) {
            if (cache.length >= packet_len) {
                // Le cache est plein, on flush avec do_request
                // On les yield pour les passer à l'itérateur
                promises.push(do_request().then(cb));
                
                // On vide le cache
                cache = [];
            }

            if (this.psiq.hasCouple(id[0], id[1])) {
                dl_lines.push(this.psiq.getLines(id[0], id[1]));
            }
            else {
                // On pousse l'ID actuel dans le cache
                cache.push(id);
            }  
        }

        // Si il y avait des lignes déjà téléchargées
        if (dl_lines.length) {
            promises.push(Promise.resolve(cb(dl_lines)));
        }

        // Si il a encore des éléments en cache (si l'itérateur n'était pas vide), 
        // alors on flush une dernière fois
        if (cache.length) {
            promises.push(do_request().then(cb));
        }

        return promises;
    }
}