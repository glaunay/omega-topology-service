class OLS {
    protected cOntology: string;
    protected restApi: string;
    protected lineage: { [termId: string]: string[] } = {};

    constructor(ontology = "mi") {
        this.cOntology = ontology;
        this.restApi = 'http://www.ebi.ac.uk/ols/api/ontologies/' + this.cOntology + '/';
    }

    protected parse(url: string) {
        console.log("fetching", url);
        return fetch(this.restApi + url, {}).then(r => r.json());
    }

    async isSonOf(childId: string, parentId: string) : Promise<boolean> {
        await this.getLineage(childId);

        return this.lineage[childId].includes(parentId);
    }

    protected async getLineage(termId: string) {
        const u = termId.replace(/:/g, "_");
        const req = await this.parse("terms/http%253A%252F%252Fpurl.obolibrary.org%252Fobo%252F" + u + "/hierarchicalAncestors");
        this.lineage[termId] = (req._embedded.terms as any[]).filter(k => k.obo_id).map(k => k.obo_id);

        console.log(this.lineage[termId]);
    }

    getTermById(termId = "") {
        const ans = this.restApi + 'terms?obo_id=' + termId;
        console.log(ans);

        if (ans === termId) {
            console.error("ID term failed");
            return undefined;
        }

        // TODO maybe incomplete
    }
}

class Registry {
    protected static data: {[index: string]: string} = {
        'dip' : "http://imex.mbi.ucla.edu/psicquic-ws/webservices/current/search/",
        'intact' : "http://www.ebi.ac.uk/Tools/webservices/psicquic/intact/webservices/current/search/",
        'mint' : "http://www.ebi.ac.uk/Tools/webservices/psicquic/mint/webservices/current/search/",
        'innatedb_imex' : "http://www.ebi.ac.uk/Tools/webservices/psicquic/innatedb/webservices/current/search/",
        'matrixdb' : "http://matrixdb.ibcp.fr:8080/psicquic/webservices/current/search/",
        'innatedb' : "http://psicquic.curated.innatedb.com/webservices/current/search/"
    };

    constructor(raw = "") {
        if (raw) {
            const parser = new DOMParser();
            let document: Document;
            
            try {
                document = parser.parseFromString(raw, 'text/xml');
                this.parseXML(document);
            } catch (e) {
                // TODO load default file (Node.js only)
            }
        }
    }

    protected parseXML(document: Document) {
        const XML_NS = "{http://hupo.psi.org/psicquic/registry}";

        for (const child of Array.from(document.children)) {
            let name = "";
            let url = "";

            for (const subChild of Array.from(child.children)) {
                if (subChild.tagName === XML_NS + "restUrl") {
                    url = subChild.textContent!;
                }
                if (subChild.tagName === XML_NS + "name") {
                    name = subChild.textContent!;
                }
            }

            name = name.toLocaleLowerCase().replace(/-/g, "_");
            Registry.data[name] = url;
        }
    }

    get(index: string) {
        return Registry.data[index];
    }

    in(index: string) {
        return index in Registry.data;
    }

    toString() : string {
        return Object.keys(Registry.data).reduce((acc, current) => acc + current + " : " + Registry.data[current] + "\n");
    }

    get [Symbol.toStringTag]() {
        return "Registry";
    }

    *[Symbol.iterator]() {
        yield* Object.keys(Registry.data);
    }
}