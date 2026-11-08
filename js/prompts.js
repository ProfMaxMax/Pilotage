/* Modèles de prompts envoyés à Claude. Ils restent courts : les règles habituelles
   (mise en page, police, encadrés, noms de fichiers…) sont dans les instructions du Projet Claude.
   Chaque modèle est modifiable dans Réglages ; les {variables} sont remplacées par l'application. */
(function (global) {
  'use strict';

  const TEMPLATES = {
    importEdt: {
      label: "Import de l'emploi du temps",
      vars: { classes: 'liste des noms courts des classes' },
      text: `Voici la photo (ou le PDF) de mon emploi du temps. Lis-le et rends-le uniquement sous forme de texte structuré, une ligne par créneau, dans un bloc de code, sans autre commentaire, dans ce format exact :

Jour | Horaire | Type | Classe | Groupe | Semaine | Semestre | Collègue

Exemple :
Lundi | 8h00-8h55 | AP | 2MV | 2MV2 | Q1 | - | -
Mardi | 8h00-9h50 | Co-intervention | CAP1 Mét + CAP1 Peint | - | Q1 | - | Zabe A.

Règles :
- Jour : Lundi, Mardi, Mercredi, Jeudi, Vendredi ou Samedi.
- Horaire : début-fin, par ex. 8h00-8h55. Deux heures consécutives identiques = une seule ligne (ex. 8h00-9h50).
- Type : Cours, AP (accompagnement), Co-intervention, ou un libellé court pour ce qui n'est pas un cours (Réunion, Aide aux élèves…).
- Classe : un de ces noms courts (plusieurs classes réunies : séparées par « + ») :
{classes}
- Groupe : le nom du demi-groupe (ex. 2MV1), « classe entière » ou « - ».
- Semaine : Toutes, Q1 ou Q2.
- Semestre : S1, S2 ou « - » si toute l'année.
- Collègue : pour une co-intervention, le nom du collègue ; sinon « - ».

Si une case est illisible, mets « ? » à cet endroit plutôt que de deviner.`,
    },
    progression: {
      label: 'Progression annuelle',
      vars: { entete: 'classe et matière', annee: 'dates de l’année', heures: 'heures disponibles', vacances: 'liste des vacances', periodes: 'PFMP, examens…' },
      text: `Progression annuelle
{entete}

{annee}
{heures}
Une séance = une heure.

Vacances :
{vacances}

PFMP, examens et périodes sans cours :
{periodes}

Construis la progression annuelle d'après le programme officiel (fichiers du Projet) et les consignes du Projet. Garde une marge d'environ 10 % des heures disponibles pour les imprévus et les évaluations.
1. Produis le fichier de progression (document lisible : séquences, objectifs, séances, dates indicatives).
2. Termine par un bloc de code à coller dans mon application, exactement dans ce format, sans rien d'autre dans le bloc :

SÉQUENCE | 1 | Titre de la séquence | nombre d'heures
1 | Titre de la séance 1
2 | Titre de la séance 2
SÉQUENCE | 2 | Titre de la séquence | nombre d'heures
1 | Titre de la séance 1

Le nombre de lignes de séances d'une séquence doit être égal à son nombre d'heures. La numérotation des séances recommence à 1 dans chaque séquence. Les titres de séances sont courts (moins de 60 caractères).
(Je peux aussi importer un tableau daté séance par séance — CSV ou Excel — avec les colonnes Date, Séquence, N°, Titre, Type.)`,
    },
    demarrage: {
      label: 'Démarrage de séquence',
      vars: { entete: 'classe et matière', sequence_num: 'numéro', sequence: 'titre de la séquence', seances: 'liste des séances' },
      text: `Nouvelle séquence
{entete}
Séquence {sequence_num} : {sequence}

Séances prévues (une heure chacune) :
{seances}

Cette conversation servira à toute la séquence : séances une par une, corrigés, évaluations, exercices en plus, notions et compétences, corrections et nouvelles versions. Applique les consignes du Projet.
Pour l'instant, ne génère rien : confirme simplement que tu as bien la séquence et la liste des séances.`,
    },
    seance: {
      label: 'Séance',
      vars: { entete: 'classe et matière', sequence_num: 'numéro', sequence: 'titre', seance_num: 'numéro de la séance', seance: 'titre de la séance', seances_precedentes: 'séances déjà vues' },
      text: `{entete}
Séquence {sequence_num} : {sequence}
Séance {seance_num} : {seance}

Séances précédentes dans la séquence :
{seances_precedentes}

Livrables attendus, selon les consignes du Projet :
- fiche élève en PDF ;
- fiche professeur en Word.

Ne fais pas encore le corrigé à publier aux élèves : je le demanderai à part pour la version finale.`,
    },
    corrige: {
      label: 'Corrigé',
      vars: { entete: 'classe et matière', sequence_num: 'numéro', sequence: 'titre', seance_num: 'numéro', seance: 'titre de la séance' },
      text: `{entete}
Séquence {sequence_num} : {sequence}
Séance {seance_num} : {seance}

La fiche élève de cette séance est finalisée (dernière version dans cette conversation).
Produis maintenant le corrigé en PDF, à publier aux élèves, selon les consignes du Projet.`,
    },
    evaluation: {
      label: 'Évaluation',
      vars: { entete: 'classe et matière', sequence_num: 'numéro', sequence: 'titre', type_eval: 'partielle / fin de séquence', duree: 'durée', seances_concernees: 'séances évaluées' },
      text: `{entete}
Séquence {sequence_num} : {sequence}

Évaluation {type_eval}
Durée : {duree}
Séances concernées :
{seances_concernees}

Produis l'évaluation en PDF selon les consignes du Projet (consignes, mise en page, barème, durée réelle).`,
    },
    exercices: {
      label: 'Exercices en plus',
      vars: { entete: 'classe et matière', sequence_num: 'numéro', sequence: 'titre', seances_concernees: 'séances visées', serie_num: 'numéro de la série' },
      text: `{entete}
Séquence {sequence_num} : {sequence}

Exercices en plus — série {serie_num}
Séances concernées :
{seances_concernees}

Mêmes notions, même niveau, difficulté comparable.
Des exercices vraiment nouveaux : autres énoncés, autres contextes, autres valeurs, autres situations professionnelles.
Ne reprends aucun exercice déjà fait dans cette conversation (fiches, évaluations, séries précédentes).`,
    },
    notions: {
      label: 'Notions de la séquence',
      vars: { entete: 'classe et matière', sequence_num: 'numéro', sequence: 'titre', seances: 'liste des séances' },
      text: `{entete}
Séquence {sequence_num} : {sequence}

Séances :
{seances}

Produis le document des notions de la séquence : notions, connaissances attendues et objectifs, d'après le programme officiel (fichiers du Projet).`,
    },
    competences: {
      label: 'Compétences de la séquence',
      vars: { entete: 'classe et matière', sequence_num: 'numéro', sequence: 'titre', seances: 'liste des séances' },
      text: `{entete}
Séquence {sequence_num} : {sequence}

Séances :
{seances}

Produis le document de synthèse des compétences : formulation officielle du programme, mise en œuvre dans la séquence, séances concernées.`,
    },
  };

  function render(key, vars, overrides) {
    const tpl = (overrides && overrides[key]) || TEMPLATES[key].text;
    return tpl.replace(/\{([a-z_]+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  }

  global.PROMPTS = { TEMPLATES, render };
})(window);
