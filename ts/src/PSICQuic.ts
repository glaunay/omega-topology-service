import ReversibleKeyMap from 'reversible-key-map';
import { PSQData, PSQDatum, PSQField } from './PSICQuicData';
import readline from 'readline';
import fs from 'fs';
import { setIntersection, countFileLines } from './helpers';
import ProgressBar from 'progress';

export type PSQDataHolder = ReversibleKeyMap<string, string, PSQData[]>;

interface InteractionMethodsStats { 
    [miId: string]: { name: string, count: number } 
}

export default class PSICQuic {
    public static mitabLvls = ["25", "27"];
    // public static web = new OLS;

    public records = new ReversibleKeyMap<string, string, PSQData[]>();
    public registredPublications: { [pubId: string]: string } = {};
    // public registry = new Registry;
    protected init_promise = Promise.resolve();

    constructor(protected mode = "LOOSE", protected keep_raw = false, offline = true) {
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

    readLines(str: string | string[]) {
        if (typeof str === 'string') {
            str = str.split('\n');
        }

        const added_psq: PSQData[] = [];
        for (const line of str) {
            this.parseLine(line, added_psq);
        }

        return added_psq;
    }

    async read(file: string, with_progress = true) {
        let lineCount = 0;
        if (with_progress)
            lineCount = await countFileLines(file);

        let lineNr = 0;
        let bar: ProgressBar = undefined;
        if (with_progress)
            bar = new ProgressBar(':current/:total :bar (:percent, :etas) ', { total: lineCount + 1, complete: "=", incomplete: " ", head: '>' });

        return new Promise(resolve => {
            const lineReader = readline.createInterface({
                input: fs.createReadStream(file)
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

    protected static bulkGetWrap(ids: string[]) : any {
        return { docs: ids.map(id => { id }) };
    }

    clone() {
        const newclone = new PSICQuic;
        newclone.records = this.records;
    }

    plus(other: PSICQuic) : PSQData[] {
        for (const [, value] of other.records) {
            for (const line of value) {
                if (this.checkPsqData(line)) {
                    this.update(line);
                }
            }
        }
        
        return [].concat(...this.records.values());
    }

    protected checkPsqData(psqDataObj: PSQData) {
        const pmid = psqDataObj.pmid!;
        const source = psqDataObj.source!.toLowerCase();
        if (!(pmid in this.registredPublications)) {
            this.registredPublications[pmid] = source;
            console.log("Putting " + source +  ' in ' +  this.registredPublications[pmid]);
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

    get length() : number {
        return this.records.size;
    }

    toString() : string {
        return [...this.records.values()].map(e => e.toString()).join("\n");
    }

    get [Symbol.toStringTag]() {
        return "PSICQuic";
    }

    getByIndex(i: number) : PSQData {
        return [].concat(...this.records.values())[i];
    }

    has(id: string) : boolean {
        return this.records.has(id);
    }

    hasCouple(id1: string, id2: string) : boolean {
        return this.records.hasCouple(id1, id2);
    }

    get(id: string) : PSQData[] {
        if (this.has(id)) {
            return [].concat(...this.records.getAllFrom(id).values());
        }
        return [];
    }

    getLines(id1: string, id2: string) : PSQData[] {
        if (this.hasCouple(id1, id2)) {
            return this.records.get(id1, id2);
        }
        return [];
    }

    update(psq: PSQData) {
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
            yield [keys[0], keys[1], lines] as [string, string, PSQData[]];
        }
    }

    getAllPartnersPairs() {
        const couples: { [id: string]: Iterable<string> } = {};

        for (const [keys, ] of this.records) {
            const [id1, id2] = keys;

            if (id1 in couples)
                (couples[id1] as Set<string>).add(id2);
            else
                couples[id1] = new Set([id2]);
            
            if (id2 in couples)
                (couples[id2] as Set<string>).add(id1);
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
        const couples: { 
            [id: string]: {
                [coupledId: string]: string[]
            }
        } = {};

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

    json(filename?: string) {
        let str = '{"type" : "mitabResult", "data" : [' + [...this].map(e => e.json).join(',') + '] }';

        if (filename && process) {
            fs.writeFileSync(filename, str);
        }

        return str;
    }

    dump(filename?: string) {
        if (filename) {
            fs.writeFileSync(filename, this.toString());
        }

        return this.toString();
    }

    protected parse(buffer: string[], encoder?: string) {
        for (const line of buffer) {
            if (line.length === 0 || line.startsWith('#')) {
                continue;
            }

            // ignoring encoder in JS
            this.update(new PSQData(line, this.keep_raw));
        }
    }

    protected parseLine(line: string, added?: PSQData[]) {
        if (line.length === 0 || line.startsWith('#')) {
            return;
        }

        const d = new PSQData(line, this.keep_raw);
        if (added) added.push(d);
        this.update(d);
    } 
    
    protected countPmid() {
        return new Set([...this].map(e => e.pmid!));
    }

    topology(type = "uniprotID") : [Set<string>, Map<[string, string], PSQData[]>] {
        const nodes = new Set<string>();
        const edges = new Map<[string, string], PSQData[]>();

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
            let l: string[] = [];

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

    filter(uniprot = [], predicate?: Function) {
        const target = new PSICQuic(undefined, undefined, true);

        if (uniprot.length) {
            const buffer = new Set(uniprot);

            for (const data of this) {
                let up: [string, string] | Set<string> = data.uniprotPair;
                if (!up) {
                    continue;
                }

                up = new Set(up);
                if (setIntersection(up, buffer).size) {
                    target.records[data.hash] = data;
                }
            }
        }
        
        if (predicate) {
            for (const data of this) {
                if (predicate(data)) target.records[data.hash] = data;
            }
        }

        return target;
    }

    // UNUSABLE
    /* 

    convert(biogrid?: BioGridMapper) {
        if (biogrid) {
            for (const psqData of this) {
                PSICQuic.convert(psqData, biogrid);
            }
        }
    } 

    protected static convert(psqDataObj: PSQData, BiogridMapper?: BioGridMapper) {
        for (const i of [0, 1]) {
            if (psqDataObj.data[i].data[0].type === 'uniprotkb:') {
                continue;
            }

            const tmp = psqDataObj.data[i].data[0].toString();
            const v = psqDataObj.data[i+2].at('biogrid');

            if (!v) {
                break;
            }

            const u = BiogridMapper.call(undefined, v[0]);

            if (!u) {
                break;
            }

            psqDataObj.data[i] = new PSQDatum('uniprotkb:' + u);
            psqDataObj.data[i + 2].data.push(new PSQField(tmp));
        }
    }

    // TODO : not implemented
    // zQuerySlow(hArray)
    // zQuery(hArray)

    async query({
        providers = ["dip"],
        mitabLvl = "25",
        erasePrevious = true,
        raw = "",
        uniprotId = "",
        seeds = [],
        pair = [],
        species = []
    } = {}) {
        if (providers[0] === "*") {
            providers = [...this.registry];
        }

        if (erasePrevious) {
            this.clear();
        }

        if (!(mitabLvl in PSICQuic.mitabLvls)) {
            console.warn("Invalid mitab level " + mitabLvl);
            return;
        }

        let miqlString = "";
        if (raw) {
            miqlString = raw;
        }
        else {
            const miqlParam: string[] = [];

            // Ajout des paramètres
            // pair
            miqlParam.push("id:(" + pair.join('%20'+'AND%20') + ')');
            // uniprot ID
            miqlParam.push("id:" + uniprotId);
            // seeds
            miqlParam.push("id:(" + seeds.join('%20'+'OR%20') + ')');
            // species
            miqlParam.push("species:(" + species.join('%20'+'OR%20') + ')');

            miqlString = miqlParam.join("%20AND%20");
        }

        for (const provider of providers) {
            if (!this.registry.in(provider)) {
                console.warn("Provider is no registered database");
                continue;
            }

            const miql = this.registry.get(provider) + 'query/' + miqlString;

            let ping_return = await this.ping(miql + "?format=tab" + mitabLvl);

            if (typeof ping_return === 'number') {
                ping_return = await this.ping(miql + '?format=tab25');
            }
            else if (ping_return === null) {
                continue;
            }

            const [ans, encoder] = ping_return as [string, string];

            this.parse(ans.split('\n'), encoder);
        }
    }

    async ping(url: string) : Promise<[string, string] | number | null> {
        let request: Response;

        try {
            request = await fetch(url, {});
        } catch (e) {
            console.log(url, "HTTP error");
            return null;
        }

        if (request.ok) {
            const text = await request.text();
            const encoder = request.headers.get('Content-Type')!.split('charset=').length > 1 ? 
                request.headers.get('Content-Type')!.split('charset=')[1] : 
                'utf-8';

            return [text, encoder];
        }
        else if (request.status === 406) {
            console.log(url);
            console.log("mitab Level may not be supported retrying w/ 2.5");
            return 0;
        }
        else {
            console.log(url, "HTTP error", request, request.statusText);
            return null;
        }
    }

    async getRegistry(url: string) {
        let response: Response;

        try {
            response = await fetch(url, {});
            if (!response.ok) throw response;
        } catch (e) {
            return new Registry;
        }

        const raw = await response.text();
        return new Registry(raw);
    }

        public async analyse() {
        if (this.length === 0) {
            return undefined;
        }

        return {
            stats: await this.statInteractionMethods(),
            pmids: this.countPmid()
        };
    }

    protected async statInteractionMethods(opt?: InteractionMethodsStats) {
        let stats: InteractionMethodsStats = {};
        if (opt) {
            stats = opt;
        }
        else {
            stats = {
                "MI:0401" : { "name" : "biochemical", "count" : 0},
                "MI:0013" : { "name" : "biophysical", "count" : 0},
                "MI:0254" : {"name":"genetic interference","count" : 0},
                "MI:0428" : { "name" : "imaging technique", "count" : 0},
                "MI:1088" : { "name" : "phenotype-based detection assay", "count" : 0},
                "MI:0255" : { "name" : "post transcriptional interference", "count" : 0},
                "MI:0090" : {"name":"protein complementation assay","count":0},
                "MI:0362" : { "name" : "inference", "count" : 0},
                "MI:0063" : {"name":"interaction prediction","count":0},
                "MI:0686" : { "name" : "unspecified method", "count" : 0}
            };
        }

        let stillexp = 0;

        for (const psq of this) {
            const detectmethod = psq.interactionDetectionMethod!;
            let boolT = false;

            if (detectmethod in stats) {
                stats[detectmethod].count++;
                continue;
            }

            for (const id in stats) {
                if (await PSICQuic.web.isSonOf(detectmethod, id)) {
                    stats[id].count++;
                    boolT = true;
                    break;
                }
            }

            if (!boolT) {
                if (detectmethod === "MI:0045") {
                    stillexp++;
                }
                else {
                    console.warn("Warning: ", detectmethod, " was not cast");
                }
            }
        }

        // @ts-ignore
        stats.experimental = stillexp;

        return stats;
    }
    */
}