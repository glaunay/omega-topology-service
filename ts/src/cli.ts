import PSICQuic from './PSICQuic';
import commander from 'commander';
import fs from 'fs';
import nano from 'nano';
import http from 'http';
import HomologyTree from './HomologyTree';
import OmegaTopology from './OmegaTopology';
import ProgressBar from 'progress';
import { escapeRegExp, renewDatabase, registerPairs, registerLines } from './helpers';

// const file = "/Users/lberanger/dataOmega/mitab200K.mitab"; // merged_uniprot_safe.mitab

// (async () => {
//     const psq = new PSICQuic();
    
//     let t = Date.now();

//     await psq.read(file);

//     console.log("Read in ", (Date.now() - t) / 1000, " seconds");

//     let i = 0;
//     for (const couple of psq.couples()) {
//         if (i > 2) break;

//         if (couple[2].length > 2) {
//             console.log(couple); i++;
//         }
//     }
// })();

commander
    .option('-r, --rebuild <specie>', 'Rebuild partners from mitab & OMTree cache. Specify "all" for rebuilding all trees.')
    .option('-i, --only-interactors', 'Rebuild only interactors couples from mitab. Ignore the mitab full lines.')
    .option('-l, --only-lines', 'Rebuild only stored lines from mitab. Ignore the interactors couples.')
    .option('-t, --threads <number>', 'Number of simultenous request to database when constructing from mitab.', parseInt, 100)
    .option('-c, --rebuild-cache <specie>', 'Rebuild OMTree cache. Specify "all" for rebuilding all the cache.')
.parse(process.argv);

const CONFIG = JSON.parse(fs.readFileSync('config.json', { encoding: "utf-8" })) as { trees: string, mitab: string, couchdb: string, cache: string };

(async () => {
    // Main process
    if (commander.rebuild) {    
        const with_lines = commander.onlyLines || !commander.onlyInteractors;
        const with_partners = !commander.onlyLines || commander.onlyInteractors;

        console.log(`Rebuilding ${with_partners ? "partners" : 'only'} ${with_lines ? (with_partners ? "and " : "") + "lines" : ''}.`);

        const nn = nano(CONFIG.couchdb);

        // Reconstruction de la base de données
    
        // 1) Lecture du mitab entier (CONFIG.mitab)
        console.log("Reading Mitab file");
        const psq = new PSICQuic(undefined, with_lines);
        let t = Date.now();
        await psq.read(CONFIG.mitab);
        console.log("Read completed in ", (Date.now() - t) / 1000, " seconds");

        // 2) Vidage de l'existant
        // & 3) Construction des documents (interactors et id_map)
        console.log("Recreate current database.");
        await renewDatabase(nn, with_partners, with_lines);

        const before_run = http.globalAgent.maxSockets;
        http.globalAgent.maxSockets = 200;

        if (with_partners) {
            // 4) Obtention des paires id => partners[]
            console.log("Getting partners");
            const pairs = psq.getAllPartnersPairs();

            // 5) Insertion des paires (peut être long)
            console.log("Inserting interactors partners in CouchDB");
            await registerPairs(nn, pairs, commander.threads);
            console.log("Pairs has been successfully registered")
        }
       
        if (with_lines) {
            // 6) Obtention des objets id => { [partners]: lignes_liees[] }
            console.log("Getting raw lines to insert");
            const lines = psq.getAllLinesPaired();

            // 7) Insertion des lignes (peut être long)
            console.log("Inserting raw lines in CouchDB");
            await registerLines(nn, lines, commander.threads)
            console.log("Lines has been successfully registered");

            console.log("Flushing PSICQuic object");
            psq.flushRaw();
        }

        http.globalAgent.maxSockets = before_run;
        console.log("Rebuilding of the database is complete.");
    }
    
    if (commander.rebuild || commander.rebuildCache) {
        let specie: string = commander.rebuild || commander.rebuildCache;
    
        if (specie === "all") {
            specie = "";
        }
    
        // Vérifie que l'espèce existe dans les fichiers homologyTree
        let files = fs.readdirSync(CONFIG.trees).filter(f => f.match(/\.json$/));
        if (specie) {
            const escaped = escapeRegExp(specie);
            const match = new RegExp("^uniprot_" + escaped + "_homology\\.json$", "i");

            console.log(`Looking for specie "${specie}" into "${CONFIG.trees}".`)
            const tree = files.find(e => match.test(e));
            if (!tree) {
                // aucune espèce ne correspond
                console.error(`Any specie has matched "${specie}" while searching for homology trees. Exiting.`);
                process.exit(1);
            }

            files = [tree];
        }

        // Lecture des fichiers d'arbre à construire
        const topologies: OmegaTopology[] = [];
        for (const f of files) {
            console.log("Reading", f);
            const this_tree = new HomologyTree(CONFIG.trees + "/" + f);
            await this_tree.init();
            topologies.push(new OmegaTopology(this_tree));
        }

        console.log("Trees has been read, constructing graphes.\n");

        const total_length = topologies.reduce((previous, current) => {
            return previous + current.hDataLength;
        }, 0);

        const bar = new ProgressBar(":tree: :current partners of :total completed (:percent, :etas remaining)", total_length);
        let i = 0;
        for (const t of topologies) {
            bar.tick(0, { tree: `Constructing ${files[i]}` });
            i++;

            await t.init();

            await t.buildEdgesReverse(bar);

            t.definitiveTrim(30, 20, 30);
        }

        bar.terminate();

        console.log("Saving trees to cache.");
        i = 0;
        for (const t of topologies) {
            const filename = files[i].replace('.json', '.topology');
            fs.writeFileSync(CONFIG.cache + filename, t.serialize(false));

            console.log(`${files[i]}'s tree cache has been saved.`);
            i++;
        }

        console.log("Trees has been rebuilt.");
    }
})();
