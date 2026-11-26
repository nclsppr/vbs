# 🎵 Jukorama — voter pour une chanson, mode d'emploi

Le plus simple : **double-clique sur `Voter.cmd`**. Une fenêtre noire s'ouvre,
tu tapes le nom de la chanson, c'est voté.

---

## Ce dont tu as besoin (une seule fois)

**Node.js.** Si tu ne l'as pas déjà :

1. Va sur <https://nodejs.org>
2. Clique le gros bouton vert **LTS**
3. Installe en cliquant « Suivant » jusqu'au bout
4. Ferme et rouvre la fenêtre

Pour vérifier, ouvre une invite de commandes et tape `node --version` — tu dois
voir un numéro comme `v24.15.0`.

> Le lanceur `Voter.cmd` te le dira lui-même si Node manque, avec le lien.

---

## L'utiliser — 3 étapes

### 1. Double-clique sur `Voter.cmd`

Il est dans le dossier de Jukorama. La fenêtre affiche :

```
────────────────────────────────────────────────────────────
  27/11/2026 - VBS's Staff Party
  Code 375513 — 401 chansons, 1200 votes
────────────────────────────────────────────────────────────
  Écris le titre (ou l'artiste) de la chanson, puis Entrée.
  Raccourcis : « liste » = classement, « quitter » = sortir.

>
```

### 2. Tape le nom de la chanson, puis Entrée

Tu n'as pas besoin de taper le titre exact, ni de mettre des guillemets, ni de
majuscules correctes. Tout ça marche :

```
> never gonna give you up
> paparazzi
> daft punk
> beat it
```

Le script te montre ce qu'il a compris et te demande confirmation :

```
> paparazzi
  → Paparazzi — Lady Gaga  [1 vote]
  Je vote pour ce titre ? [O/n]
```

### 3. Tape `o` (ou juste Entrée) pour confirmer

Le programme demande alors **combien de votes** tu veux mettre. Entrée = un
seul, c'est le cas normal :

```
  Combien de votes pour « Paparazzi » ?
  1 = ton profil habituel. Au-delà, les votes supplémentaires
  partent de profils jetables (comme une navigation privée) :
  ton profil enregistré n’est pas modifié et ces comptes
  seront supprimés en quittant.
  Entrée = 1 vote, sinon un nombre de 1 à 25.
  Nombre de votes :
```

```
  Vote enregistré : Paparazzi — Lady Gaga
  2 votes au total. Vérifié côté serveur : oui
```

**C'est tout.** Tu peux enchaîner d'autres titres sans quitter le programme.

> Mettre plusieurs votes sur un titre, c'est possible (un navigateur en mode
> privé le permet aussi), mais c'est **ton choix et ta responsabilité** : le
> programme te dit toujours combien tu en as mis, et te laisse les retirer.

---

## La télévision

Double-clique sur `Voter-web.cmd`. Le navigateur s'ouvre sur une vieille télé
en bois, dans un jardin sous la neige : sapin, bonhomme de neige, guirlande,
lune. Tout ce que fait le terminal se fait ici, sur l'écran de la télé.

1. La télé est éteinte. Appuie sur **MARCHE** (ou sur le post-it). Elle chauffe
   sur le logo Jukorama, le temps de trouver la fête.
2. Choisis **Salle** (ton profil est gardé sur ce PC) ou **Cabine privée**
   (rien sur le disque, les comptes sont effacés quand tu éteins).
   Touches `1` et `2`.
3. La file s'affiche avec ses pochettes. Tape un titre ou un artiste dans
   **CHERCHER** ; Entrée ouvre le premier résultat, les flèches en choisissent
   un autre. Un clic sur une ligne l'ouvre aussi.
4. Sur la fiche, choisis le nombre de votes (`−` `+`, ou 1 · 3 · 5 · 10 · 25),
   puis la touche verte **Voter**. Un tampon affiche le nouveau total et le
   rang, sous une pluie de confettis.
5. Si tu as déjà voté pour ce titre, la fiche propose **Retirer mes votes**
   (elle demande « Sûr ? »). La colonne **MES VOTES** liste tout ce que tu as
   mis, avec un bouton **Retirer** par titre.
6. Touche rouge **Tout retirer** : c'est le `reset`. Elle montre ce qui va
   partir et te fait taper `reset` pour confirmer.
7. Touche bleue **Éteindre** : garder tes votes ou tout retirer, puis la télé
   s'éteint et le programme s'arrête. En cabine privée, après ça, plus
   personne ne peut enlever ces votes.

Laisse la fenêtre noire ouverte tant que la page est ouverte : c'est elle qui
vote. `Voter-web-prive.cmd` saute le choix et entre directement en cabine.
Le terminal (`Voter.cmd`) n'a pas changé.

**Les réglages de la télé**, à droite de l'écran : trois curseurs, **NEIGE**
(de rien à la tempête), **CRT** (l'effet cathodique, à zéro l'image est nette)
et **SON**. Le navigateur s'en souvient. Le bouton avec la note passe au chant
de Noël suivant.

**Les pochettes** viennent de Spotify, comme sur le site Festify. Au premier
lancement, le programme va chercher leurs adresses en arrière-plan (une à deux
minutes pour 450 titres, sans bloquer l'écran) et les garde dans
`data\tracks-index.json` : ensuite elles s'affichent tout de suite.

**La musique** : sept chants de Noël du domaine public, joués par une boîte à
musique. Les fichiers `.mid` sont sous licence CC0 ; leurs auteurs et leurs
sources sont dans `web\music\CREDITS.txt`.

La neige tombe, se pose sur le toit de la télé et s'entasse au sol.

---

## Ce qui se passe si…

**… le titre est ambigu.** Le script ne devine jamais. Il propose une liste :

```
> daft punk
  Plusieurs chansons correspondent :
    1. Around the World — Daft Punk  [13 votes]
    2. Da Funk — Daft Punk  [5 votes]
    3. Digital Love — Daft Punk  [5 votes]
  Numéro (1-5, Entrée pour annuler) :
```

Tu tapes le numéro, puis `o` pour confirmer.

**… tu as déjà voté pour ce titre.** Il te le dit, en comptant **tous** tes
votes sur ce titre (celui de ton profil et ceux ajoutés pendant la session) :

```
> zoo
  → Zoo — Kaaris  [25 votes]
  Tu as déjà mis 3 votes sur ce titre.
  [r] retirer mes 3 votes · [v] revoter · Entrée = ne rien faire
  Ton choix [r/v] : r
  Retrait en cours…
  J’ai retiré 3 vote(s) que tu avais mis sur ce titre.
    Maintenant 22 votes au total : Zoo — Kaaris
```

- `r` retire tous tes votes sur ce titre, dit combien, et affiche le nouveau
  total de la chanson ;
- `v` en ajoute (il te redemande combien) ;
- Entrée ne change rien.

**… la chanson n'est pas dans la file.** Le script ne peut pas l'ajouter
(seul l'organisateur de la party peut écrire dans la file). Il te le dit :

```
  Aucune chanson de la file ne correspond à « cheater's town ».
  Festify n'accepte un vote que sur une chanson déjà dans la file.
  Ajoute-la depuis le site, puis reviens ici.
```

Dans ce cas : ajoute la chanson depuis le site Festify (code **375513**), puis
reviens dans le programme et retape-la.

---

## Les commandes du mode interactif

| Tu tapes | Ça fait |
| --- | --- |
| `un titre` | Cherche, montre, demande confirmation, vote |
| `mesvotes` | Affiche **tous** tes votes : ceux de ton profil et ceux ajoutés pendant la session |
| `liste` | Affiche le classement complet, trié par votes |
| `reset` | Retire **tous** tes votes, dit combien, affiche le nouveau total de chaque chanson, puis oublie ton profil |
| `quitter` | Ferme le programme |

En quittant, le programme rappelle ce que tu laisses et demande si tu gardes
tes votes (Entrée = oui). C'est vrai dans les deux modes.
Tu peux aussi écrire `/vote paparazzi` — le préfixe `/vote` est accepté et
ignoré, comme dans ton idée d'origine.

### Voir ses votes

```
> mesvotes
Votes de jh2VqMgn5mR8ovbQ1NYTt6Xx8Gi2 (2) :
   28  Never Gonna Give You Up — Rick Astley
   25  Zoo — Kaaris

  En plus dans cette session, depuis des profils jetables : 2
     2×  Zoo — Kaaris
```

Le premier bloc, ce sont les votes de ton profil (le nombre à gauche est le
total de la chanson, comme dans `liste`). Le second n'apparaît que si tu as mis
plusieurs votes sur un titre pendant cette session : ce sont les votes en plus.

Les chansons qui ne sont plus dans la file sont marquées `[plus dans la file]`.

### Tout retirer (`reset`)

Quand tu quittes, le programme demande si tu veux **conserver** tes votes
(Entrée = oui, c'est le défaut). Si tu réponds non, ou si tu tapes `reset` à
tout moment :

```
> reset
  Ton profil jh2VqMgn5mR8ovbQ1NYTt6Xx8Gi2 détient 1 vote(s) :
    - Zoo — Kaaris
  En plus, cette session : 2 vote(s) depuis des profils jetables :
     2×  Zoo — Kaaris

  Attention : ceci retire TOUS tes votes et SUPPRIME ton profil.
  Un nouveau profil sera créé ensuite : tu pourras donc revoter pour
  les mêmes titres, ce qui revient à bourrer les urnes.
  Pour ne retirer que tes votes sur un titre, tape ce titre.
  Confirmer le reset ? Tape "reset" pour confirmer : reset
  Retrait en cours…
  J’ai retiré 3 vote(s) que tu avais enregistré(s).
  (1 de ton profil, 2 depuis des profils jetables)
    Maintenant 22 votes au total : Zoo — Kaaris
  Profil local oublié : un nouveau sera créé au besoin.
```

Il faut **retaper le mot `reset`** pour confirmer : une simple touche Entrée ne
suffit pas, pour éviter un effacement accidentel.

Le reset te dit donc toujours **combien de votes il a retirés** et **le nouveau
total de chaque chanson concernée**. Si un vote n'a pas pu être retiré (coupure
réseau), il le dit aussi (« Échec pour 1 vote(s)… ») et le garde en mémoire :
retape `reset` pour réessayer.

⚠️ Le reset supprime aussi `data\auth.json`. Un nouveau profil anonyme est créé
dès que le programme en a besoin — tu peux donc revoter pour les mêmes
chansons. Festify n'a aucun moyen de le détecter, mais c'est à toi de rester
correct avec les autres invités.

**Pour retirer tes votes sur une seule chanson** (le cas normal), tape
simplement son titre, puis `r`.

---

## 🔒 Mode privé (RGPD)

Double-clique sur **`Voter-prive.cmd`** au lieu de `Voter.cmd`, ou lance :

```powershell
node jukorama.js shell --private
```

Ce mode crée un profil anonyme **jetable**, jamais écrit sur le disque, et
**supprime le compte Firebase** en quittant (effacement au sens de l'art. 17 du
RGPD).

### Ce que le mode privé garantit

| Point | Mode normal | Mode privé |
| --- | --- | --- |
| Profil écrit sur le disque | oui (`data\auth.json`) | **non**, mémoire seulement |
| Compte Firebase conservé après la sortie | oui | **non**, supprimé |
| Festify peut relier tes votes à un compte | oui | **non** (uid orphelin) |
| Tes votes sont conservés | oui | **oui, par défaut** (tu peux les retirer à la sortie) |

Festify ne stocke **ni nom ni email** pour un votant anonyme : l'uid est le seul
identifiant personnel qui existe. Le mode privé supprime ce compte à la sortie,
donc il ne reste que des identifiants opaques qui ne résolvent plus vers aucun
compte.

### Revoter plusieurs fois (assumé et signalé)

En mode privé, tu choisis combien de votes tu mets sur un titre : le programme
crée un **nouveau profil anonyme pour chaque vote**. Chaque vote compte.

Il te rappelle explicitement où tu en es :

```
> zoo
  → Zoo — Kaaris  [22 votes]
  Je vote pour ce titre ? [O/n] o

  Combien de votes pour « Zoo » ?
  Chaque vote part d’un profil anonyme neuf, comme si tu rouvrais
  une fenêtre de navigation privée.
  Entrée = 1 vote, sinon un nombre de 1 à 25.
  Nombre de votes : 5
  Vote 1/5 enregistré.
  …
  Vote 5/5 enregistré.
  ! C'est ton 5e vote pour ce titre dans cette session.
```

### `mesvotes` et `reset` en mode privé

Comme chaque vote vit sur son propre profil jetable, ces deux commandes
parlent de **toute ta session**, jamais d'un seul profil :

```
> mesvotes
  Tes votes dans cette session (mode privé) : 5
     5×  Zoo — Kaaris  [27 au total]

> reset
  Pendant cette session, tu as mis 5 vote(s) :
     5×  Zoo — Kaaris
  (répartis sur 5 profil(s) anonyme(s) jetable(s))
  Tout retirer ? [O/n] o
  Retrait en cours…
  J’ai retiré 5 vote(s) que tu avais mis dans cette session.
    Maintenant 22 votes au total : Zoo — Kaaris

> mesvotes
  Aucun vote dans cette session.
```

Le `reset` du mode privé ne touche **jamais** au profil enregistré du mode
normal (`data\auth.json`) : il ne retire que ce que cette session a voté.

Pour ne retirer que tes votes sur un titre, tape ce titre puis `r`.

### En quittant

Le récapitulatif te montre tout ce que tu laisses :

```
  Récapitulatif de la session :
     3×  Zoo — Kaaris  ← 3 votes sur ce titre

  Tu as voté plusieurs fois pour 1 titre(s).

  Garder ces votes ? [O/n]
```

Réponds `n` pour tout retirer avant que les comptes soient supprimés : le
programme te dit alors combien il en a retiré et le nouveau total de chaque
chanson. **Après la sortie, plus personne ne peut enlever ces votes** — même
pas toi : les comptes qui les détenaient n'existent plus.

**C'est toi qui décides.** Le programme ne t'empêche pas de voter cinq fois ; il
te le dit clairement pour que ce soit un choix conscient. C'est la même liberté
qu'un navigateur en mode privé, avec l'information en plus.

### Ce qu'il ne garantit pas

**Le vote reste visible.** Festify doit enregistrer quelque chose pour compter :
la ligne `votes/<chanson>/<uid>` existe. Le mode privé rend l'uid non
attribuable, il ne l'efface pas instantanément.

**Ton adresse IP est vue par Festify.** L'appel part de ta machine, comme avec
le site web ; seul un VPN changerait ça.

**Un token de compte supprimé reste accepté quelques minutes** par la base
Festify (observé : une écriture avec le token d'un compte supprimé renvoie
encore `200`). D'où l'ordre « retirer les votes, puis supprimer le compte ».

---

## Effets visuels (écran cathodique, sapin, neige)

Le mode interactif s'ouvre sur une intro rétro : allumage d'un tube cathodique,
sapin de Noël en ASCII avec guirlandes qui scintillent, neige en trois couches
de profondeur, scanlines sur les lignes impaires.

```
              *
             /_\
            /___\
           /_*_*_\
          /___A___\
         /_*____*_\
        /___A___A___\
             |||
           __|||__

        ★  B I E N T Ô T   N O Ë L  ★
            VBS's Staff Party
     ▓▓▓▓▓▓▓▓░░  CHRISTMAS MODE  ·  60HZ
```

Puis **toute la session reste dans le style** : un cadre permanent, la neige qui
tombe derrière le texte, une barre d'état vivante avec le compteur de votes, la
spinner, l'heure et une guirlande animée.

```
╔═ JUKORAMA ═════════════════════════════════ party 375513 ╗
║  27/11/2026 - VBS Staff Party                            ║
║  Code 375513 - 402 chansons                              ║
║                                                          ║
║  Bienvenue !                              *              ║
║                          ·        '                      ║
╠══════════════════════════════════════════════════════════╣
║ ⠹ · 1217 votes · 2 cette session · PRIVE · 17:07  •··••• ║
║> paparazzi█                                              ║
╚══════════════════════════════════════════════════════════╝
```

Chaque vote s'imprime comme un tampon de machine, suivi d'une **pluie de
confettis** :

```
╔══════════════════════════════════╗
  ★ VOTE ENREGISTRE
║                                  ║
║  Paparazzi — Lady Gaga           ║
║  2 votes au total                ║
╚══════════════════════════════════╝
```

**N'importe quelle touche passe l'intro.** Chaque vote s'affiche dans un
cadre qui se dessine, et la sortie referme le tube.

Les effets sont **inactifs automatiquement** quand la sortie n'est pas un
terminal : commandes en série, redirection, CI. Le script reste donc utilisable
comme n'importe quel outil.

| Variable | Effet |
| --- | --- |
| `JUKORAMA_NO_FX=1` | désactive les animations |
| `JUKORAMA_PLAIN=1` | force le mode texte simple |
| `JUKORAMA_FX_SIZE=80x24` | taille imposée (utile pour tester) |

L'écran tourne dans le buffer alternatif du terminal : il **n'efface jamais**
l'historique de ta session, et tout est restauré en sortant.

---

## Alternative : en une seule ligne (sans le mode interactif)

Si tu préfères la ligne de commande classique, ouvre un terminal dans
le dossier de Jukorama et lance :

```powershell
node jukorama.js vote "paparazzi"
node jukorama.js vote "cheater's town" "chris isaak"
node jukorama.js list "daft"
node jukorama.js unvote "paparazzi"
```

Ici les guillemets sont nécessaires (ils protègent les espaces et les
apostrophes). Le mode interactif évite tout ça.

---

## Questions rapides

**Est-ce que je peux voter plusieurs fois pour la même chanson ?**
Oui, si tu le décides : après la confirmation, le programme demande combien de
votes tu veux mettre (Entrée = 1). Un profil ne détient qu'un vote par chanson,
exactement comme sur le site ; chaque vote en plus part donc d'un profil
anonyme jetable, comme si tu rouvrais une fenêtre de navigation privée. Le
programme ne le cache pas : il te rappelle combien tu en as mis, les compte
dans `mesvotes`, et `reset` les retire tous. C'est ta responsabilité vis-à-vis
des autres invités.

**Comment voir ce que j'ai voté ?**
Tape `mesvotes` dans le programme. Tu y vois les votes de ton profil et ceux
ajoutés pendant la session.

**J'ai mis 5 votes, `reset` va bien retirer les 5 ?**
Oui. `reset` (et `r` après avoir tapé un titre) retire tous les votes que tu
as mis, y compris ceux partis de profils jetables, puis annonce combien il en
a retiré et le nouveau total de la chanson. Une seule limite : les votes en
plus ne peuvent être retirés que **pendant la session qui les a créés**. Une
fois le programme fermé, les profils jetables sont supprimés et ces votes
restent en place.

**Comment repartir de zéro ?**
Tape `reset` dans le programme. Il retire tous tes votes, supprime ton profil
local et demande une confirmation explicite (tu dois retaper `reset`). Un
nouveau profil est créé dès que le programme en a besoin.

**Où est enregistrée mon identité ?**
Dans `data\auth.json`. **Ne le supprime pas** à la main : tu perdrais le lien
avec tes votes (tu pourrais revoter, ce qui reviendrait à bourrer les urnes).
Si tu changes de machine, copie ce fichier. Si tu veux vraiment repartir de
zéro, utilise `reset`, qui retire proprement tes votes d'abord.

**Le premier lancement est un peu lent, c'est normal ?**
Oui, environ 30 secondes : le script télécharge la liste des titres des 400
chansons pour pouvoir les retrouver par leur nom. C'est mis en cache dans
`data\tracks-index.json`, les lancements suivants sont instantanés. Quand
quelqu'un ajoute une chanson, la mise à jour se refait toute seule.
Si le compteur s'arrête et que la ligne dit « petite pause », le service des
titres demande de ralentir : ça reprend tout seul. Un titre qui ne répond pas
est laissé de côté et relu au prochain lancement.

**Ça marche encore pour une autre soirée ?**
Oui, avec `--party` et l'identifiant de la party :

```powershell
node jukorama.js party --party <id>
```

L'identifiant est la partie après `/party/` dans l'URL Festify.

**Erreur « Connect Timeout », « fetch failed » ou de certificat ?**
Le script active maintenant tout seul le support du proxy : il détecte le proxy
(configuré dans tes variables d'environnement ou dans les paramètres Windows) et
se relance avec `--use-env-proxy`. Tu ne devrais rien avoir à faire.

Si ça bloque quand même, lance dans une invite de commandes :

```powershell
cd /d C:\chemin\vers\jukorama
node --use-env-proxy --use-system-ca jukorama.js party
```

Le lanceur affiche aussi un bloc « Diagnostic réseau » en cas d'échec.

---

## Récap visuel

```
Double-clic sur Voter.cmd
        ↓
   tape le titre
        ↓
   o  (ou Entrée)
        ↓
     voté ✅
```

Et pour retirer : retape le même titre, puis réponds `r`.
