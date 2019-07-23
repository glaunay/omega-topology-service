#!/usr/bin/python3
import os, sys, re

if len(sys.argv) < 2:
    print("You must specify input files.")
    exit()

files = sys.argv[1:]

output_file = open('merged.mitab', 'w')

mitab_cache = {}
reg = re.compile("^(uniprotkb:)?(.+)");

for f in files:
    with open(f) as content:
        l = content.readline()

        while l:
            # Récupération des deux ID uniprot
            lineS = l.split('\t')
            matches = reg.match(lineS[0])
            id1 = matches.group(2)
            matches = reg.match(lineS[1])
            id2 = matches.group(2)

            concat_line = "\t".join([id1, id2, *lineS[2:]])
            md5_concat = hash(concat_line)

            if not id1 in mitab_cache:
                mitab_cache[id1] = { id2: set() }
            if not id2 in mitab_cache:
                mitab_cache[id2] = { id1: set() }

            if not id2 in mitab_cache[id1]:
                mitab_cache[id1][id2] = set()
            if not id1 in mitab_cache[id2]:
                mitab_cache[id2][id1] = set()
            
            # Teste si la ligne existe déjà (que dans id1, c'est réflexif)
            if md5_concat not in mitab_cache[id1][id2]:
                # Elle existe pas, on l'écrit dans le fichier final
                output_file.write(l)

                # On enregistre le hash
                mitab_cache[id2][id1].add(md5_concat)
                mitab_cache[id1][id2].add(md5_concat)

            l = content.readline()

