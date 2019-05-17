import { readFileSync } from "fs";

if (typeof window === 'undefined' || !window.fetch) {
    var fetch = require('node-fetch') as GlobalFetch["fetch"];
}

export default class PartnersMap {
    protected interactions: { [id: string]: string[] } = {};
    protected url: string;
    
    constructor({ 
        filename = undefined,
        database_url = undefined
     } = {}) {
        if (filename)
            this.interactions = JSON.parse(readFileSync(filename, { encoding: "utf-8" }));
        if (database_url)
            this.url = database_url;
    }

    classicGet(id: string) {
        if (id in this.interactions) {
            return this.interactions[id].map(e => [id, e]) as [string, string][];
        }
    }

    async *getAll(id: string) {
        yield* await new Promise(resolve => {
            setTimeout(() => {
                if (id in this.interactions) {
                    resolve(this.interactions[id].map(e => [id, e]) as [string, string][]);
                }
                resolve([]);
            }, 0);
        }) as [string, string][];
    }

    async *bulkGet(ids: Iterable<string>, packet_len = 128) {
        let cache = [];

        const do_request = async () => {
            // On les récupère
            const partners = await fetch(this.url, {
                method: "POST",
                body: JSON.stringify({ keys: cache }),
                headers: { "Content-Type": "application/json" }
            }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e)));

            return partners.request as { [id: string]: { partners: string[] } };
        };

        // Parcours de l'itérable
        for (const id of ids) {
            if (cache.length >= packet_len) {
                // Le cache est plein, on flush avec do_request
                // On les yield pour les passer à l'itérateur
                try {
                    yield await do_request();
                } catch (e) {
                    console.error(e);
                }
                
                // On vide le cache
                cache = [];
            }
            
            // On pousse l'ID actuel dans le cache
            cache.push(id);
        }

        // Si il a encore des éléments en cache (si l'itérateur n'était pas vide), 
        // alors on flush une dernière fois
        if (cache.length) {
            try {
                yield await do_request();
            } catch (e) {
                console.error(e);
            }
        }
    }
}