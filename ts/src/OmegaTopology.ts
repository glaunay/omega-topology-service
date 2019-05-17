import HomologTree, { HomologChildren } from "./HomologyTree";
import { Graph, json as GraphJSON } from "graphlib";
import { HoParameterSet, HoParameter } from "./HoParameter";
import { MDTree } from './MDTree';
import PartnersMap from './PartnersMap';
import { setUnion } from './helpers';
import zip from 'python-zip';
import md5 from 'md5';
import { MitabTopology } from "./MitabTopology";

interface NodeGraphComponent {
    group: number;
    val: number;
}

interface SerializedOmegaTopology {
    graph: Object;
    tree: string;
    homolog?: string;
    version: number
}

export default class OmegaTopology {
    protected hData: HomologTree;
    protected ajdTree: MDTree<HoParameterSet> = new MDTree(false);
    protected baseTopology?: MitabTopology; 
    
    /**
     * GRAPH
     * Node type: string
     * Node data / label: NodeGraphComponent
     * Edge data / label: HoParameterSet
     */
    protected G: Graph;


    constructor(homologyTree: HomologTree, mitabObj?: MitabTopology) {
        this.hData = homologyTree;
        this.baseTopology = mitabObj;
        this.G = new Graph({directed: false});
    }

    init() {
        return this.hData.init();
    }

    prune(renew = true, max_distance: number = 5, ...seeds: string[]) : Graph {
        console.log(seeds);

        // Set all nodes visible
        if (renew) {
            for (const [, , datum] of this) {
                datum.visible = true;
            }
        }

        this.G = this.makeGraph();

        let t = Date.now();
        console.log("Graph has", this.G.nodeCount(), "nodes and", this.G.edgeCount(), "edges");

        const _seeds = new Set(seeds);

        const seed_set = [];
        const other_set = [];

        for (const n of this.G.nodes()) {
            // this.showNode(n);

            if (_seeds.has(n)) {
                this.G.setNode(n, { group: 1 });
                seed_set.push(n);
            }
            else {
                other_set.push(n);
            }
        }

        console.log("Sets has been constructed in", (Date.now() - t)/1000, "seconds");
        t = Date.now();

        if (seeds.length === 0) {
            console.warn("No seed to prune");
        }
        else {
            // Gettings neighboors for a specific distance
            const getAvailableNeighboors = (initial: string, distance: number) => {
                distance = distance > 0 ? distance : 1;
                console.log("Distance", distance);
                const node = this.G.node(initial);
                if (!node) {
                    return new Set;
                }

                let to_visit = new Set(this.G.neighbors(initial) as string[]);
                let visited = new Set([initial]);

                while (distance > 0) {
                    let tampon = new Set;
                    // Ajout de chaque voisin des voisins
                    for (const visitor of to_visit) {
                        if (!visited.has(visitor)) {
                            // Si ce noeud n'est pas encore visité
                            // On l'ajoute pour ne jamais le revisiter
                            visited.add(visitor);

                            // On regarde ses voisins
                            // Et ajout de tous dans les noeuds à visiter
                            tampon = setUnion(tampon, this.G.neighbors(visitor) as string[]);
                        }
                    }

                    // Mise à jour de to_visit avec le set tampon
                    to_visit = tampon;

                    distance--;
                }

                console.log(visited);

                return visited;
            };

            // console.log(this.G);
            for (const seed of seed_set) {
                const paths_f_seed = getAvailableNeighboors(seed, max_distance);

                for (const node of other_set) {
                    if (!paths_f_seed.has(node)) {
                        this.G.removeNode(node);
                        this.hideNode(node);
                    }
                }
            }
        }

        console.log("Paths found in", (Date.now() - t)/1000, "seconds");
        t = Date.now();

        // Exploring degree for all nodes
        // TODO TOCHECK
        for (const node of this.G.nodes()) {
            const node_value = this.G.node(node) as NodeGraphComponent;
            const edges = this.G.nodeEdges(node);

            if (edges) {
                node_value.val = edges.length;
            }
        }

        console.log("Degrees has been set in", (Date.now() - t)/1000, "seconds");

        return this.G;
    }

    *[Symbol.iterator]() : IterableIterator<[string, string, HoParameterSet]> {
        yield* this.ajdTree;
    }

    *iterVisible() : IterableIterator<[string, string, HoParameterSet]> {
        for (const [k1, k2, datum] of this) {
            if (!datum.isEmpty && datum.visible) {
                yield [k1, k2, datum];
            }
        }
    }

    *templatePairs() : IterableIterator<[HoParameter, HoParameter]> {
        for (const [, , set] of this) {
            yield* zip(set.lowQueryParam, set.highQueryParam) as IterableIterator<[HoParameter, HoParameter]>;
        }
    }

    dump() {
        const nodes: any[] = []; /// TODO obtenir les noeuds
        const links = [...this.iterVisible()].map(([source, target, data]) => { return { source, target, data }; });

        return { nodes, links };
    }

    dumpGraph(trim_invalid = true) {
        const graph: any = GraphJSON.write(this.G);

        if (trim_invalid) {
            // Trimming invalid
            for (const link of graph.edges) {
                // Copy link.value
                link.value = { ...link.value };

                // filter low query param & high query param
                link.value.lowQueryParam = link.value.lowQueryParam.filter(e => e.valid);
                link.value.highQueryParam = link.value.highQueryParam.filter(e => e.valid);
            }
        }

        return JSON.stringify(graph);
    }

    serialize(with_homology_tree = true) : string {
        const obj: SerializedOmegaTopology = {
            graph: GraphJSON.write(this.G),
            tree: this.ajdTree.serialize(),
            version: 1
        };

        if (with_homology_tree) {
            obj.homolog = this.hData.serialize();
        }

        return JSON.stringify(obj);
    }

    static from(serialized: string) : OmegaTopology {
        const obj: SerializedOmegaTopology = JSON.parse(serialized);

        const supported = [1];
        if (!supported.includes(obj.version)) {
            throw new Error("Unsupported OmegaTopology version: " + obj.version);
        }

        const newobj = new OmegaTopology(undefined);
        newobj.ajdTree = MDTree.from(obj.tree) as MDTree<HoParameterSet>;
        newobj.G = GraphJSON.read(obj.graph);

        if (obj.homolog) {
            newobj.hData = HomologTree.from(obj.homolog);
        }

        return newobj;
    }

    protected makeGraph() {
        const g = new Graph({ directed: false });

        for (const [n1, n2, edgeData] of this.iterVisible()) {
            g.setNode(n1, { group: 0, val: 0 }).setNode(n2, { group: 0, val: 0 }).setEdge(n1, n2, edgeData);
        }

        return g;
    }

    get edgeNumber() : number {
        return [...this.iterVisible()].length;
    }

    get nodeNumber() : number {
        return Object.keys(this.nodes).length;
    }

    get nodes() {
        const nodes: { [id: string]: Set<any> } = {};

        for (const [n1, n2, e] of this.iterVisible()) {
            const templates = e.templates;

            nodes[n1] = nodes[n1] ? nodes[n1] : new Set;
            for (const element of templates[0]) {
                nodes[n1].add(element);
            }

            nodes[n2] = nodes[n2] ? nodes[n2] : new Set;
            for (const element of templates[1]) {
                nodes[n2].add(element);
            }
        }

        return nodes;
    }

    protected showNode(node: string) {
        const node_value = Object.entries(this.ajdTree.getNode(node));

        for (const [, edge] of node_value) {
            edge.visible = true;
        }
    }

    protected hideNode(node: string) {
        const node_value = Object.entries(this.ajdTree.getNode(node));

        for (const [, edge] of node_value) {
            edge.visible = false;
        }
    }

    get length() {
        return this.ajdTree.length;
    }

    get hDataLength() {
        return this.hData.length;
    }

    async buildEdgesReverse(bar: any /** Progress bar (any for not importing Progress in clients) */) {
        const inters = new PartnersMap({ // TODO TOCHANGE
            database_url: "http://localhost:3280/bulk",
            /** filename: "/Users/lberanger/dataOmega/interactors.json" */
        });

        // let time = 0;
        let atime = 0;

        let timer = Date.now();

        // On itère sur des tas d'ID récupérés depuis un jeu d'ID initial (contenu dans
        // this.hData), on récupère ce tas d'ID par paquets (d'où l'itérateur async)
        for await (const ids of inters.bulkGet(this.hData)) {
            if (bar) bar.tick(Object.keys(ids).length);

            // Pour chaque couple ID => partners renvoyé
            for (const [children_id, p] of Object.entries(ids)) {
                // On construit des tuples ID => partner pour chaque partner disponible
                const tuple_interactors = p.partners.map(e => [children_id, e]);

                // On les ajoute dans l'arbre
                for (const [baseIdA, baseIdB] of tuple_interactors) {
                    const dataNewA = this.hData.getChildrenData(baseIdA);
                    const dataNewB = this.hData.getChildrenData(baseIdB);
                    this.addEdgeSet(dataNewA, dataNewB);
                }

                // FACULTATIF POUR LE MOMENT
                // Pour chaque couple children_id | interactant, obtenir les données mitab
                // for (const int of [children_id, ...tuple_interactors]) {
                //     interactors_to_get++;
                //     set.add(int);
                // }
            }
        }
        atime += (Date.now() - timer);
                
        // console.log("Sync method = ", time / 1000, "seconds");
        // console.log("Async method = ", atime / 1000, "seconds, edges has been constructed");
    } 

    buildEdges() : void {
        if (!this.baseTopology) {
            throw new Error('OmegaTopology has not been initialized with base topo');
        }
    
        let nbBase = 0;

        for (const [baseIdA, baseIdB, ] of this.baseTopology) {
            const dataNewA = this.hData.getChildrenData(baseIdA);
            const dataNewB = this.hData.getChildrenData(baseIdB);
            this.addEdgeSet(dataNewA, dataNewB);
            nbBase++;
        }

        console.log(this.edgeNumber, "interactions unpacked from", nbBase);
    }

    definitiveTrim(simPic = 0, idPct = 0, cvPct = 0) : [number, number] {
        let nDel = 0;
        let nTot = 0;

        for (const [x, y, HoParameterSetObj] of this) {
            nTot++;
            HoParameterSetObj.trim(simPic, idPct, cvPct, undefined, true);

            if (HoParameterSetObj.isEmpty) {
                nDel++;
                this.ajdTree.remove(x, y);
            }
        }

        return [nDel, nTot];
    }

    trimEdges(simPic = 0, idPct = 0, cvPct = 0) : [number, number] {
        let nDel = 0;
        let nTot = 0;

        for (const [, , HoParameterSetObj] of this) {
            nTot++;
            HoParameterSetObj.trim(simPic, idPct, cvPct);

            if (HoParameterSetObj.isEmpty) {
                nDel++;
            }
        }

        return [nDel, nTot];
    }

    toString() : string {
        return JSON.stringify(Array.from(this.iterVisible()));
    }

    getEdgeSet(...args: any[]) : IterableIterator<[string, string, HoParameterSet]> | undefined {
        if (args.length === 0) {
            return this.iterVisible();
        }

        if (args.length > 2) {
            throw new Error("Excepted 0, 1 or 2 node, got " + args.length);
        }
    }

    addEdgeSet(dataNewA: HomologChildren, dataNewB: HomologChildren) : void {
        const newAelements = Object.keys(dataNewA).map(e => [md5(e), e, dataNewA[e]]) as [string, string, string[]][];
        const newBelements = Object.keys(dataNewB).map(e => [md5(e), e, dataNewB[e]]) as [string, string, string[]][];

        for (const [hA, idA, dA] of newAelements) {
            for (const [hB, idB, dB] of newBelements) {
                let dX: string[], dY: string[];
                if (hA < hB) {
                    dX = dA;
                    dY = dB;
                }
                else {
                    dX = dB;
                    dY = dA;
                }

                const HoParameterSetObj: HoParameterSet = this.ajdTree.getOrSet(idA, idB, new HoParameterSet);
                HoParameterSetObj.add(dX, dY);
            }
        }
    }

    templateZipPair() : MDTree<boolean> {
        const templateColl = new MDTree<boolean>(false);

        for (const [, , e] of this.iterVisible()) {
            const templates = e.templates;

            for (const [t1, t2] of zip(...templates)) {
                templateColl.getOrSet(t1, t2, true);
            }
        }

        return templateColl;
    }

    protected weightProjector() {
        // empty
    }
}