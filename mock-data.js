// Risposte preregistrate per la modalità DEMO.
// Hanno esattamente la forma JSON restituita da POST /api/check (FactCheckResult).
//
// Provenienza dei dati:
//  - "Earth revolves around the Sun": copiato per intero dall'output del notebook (cella 9).
//  - "Paris", "Eiffel Tower", "Einstein": etichetta e punteggio dal notebook;
//    le frasi o le probabilità segnate con PLACEHOLDER sono inventate solo per
//    disegnare l'interfaccia e vanno sostituite con output reali quando l'API gira.
window.VERITAS_MOCKS = [
  {
    claim: "The Earth revolves around the Sun.",
    predicted_label: "SUPPORTS",
    confidence: 0.8539,
    evidence_used: [
      "[Earth's orbit] Earth 's orbit is the path through which the Earth travels around the Sun .",
    ],
    evidence_scores: [
      {
        text: "[Earth's orbit] Viewed from a vantage point above the north poles of both the Sun and the Earth , the Earth would appear to revolve in a counterclockwise direction about the Sun .",
        SUPPORTS: 0.7934,
        REFUTES: 0.1117,
        "NOT ENOUGH INFO": 0.0949,
      },
      {
        text: "[Earth's orbit] Earth 's orbit is the path through which the Earth travels around the Sun .",
        SUPPORTS: 0.8539,
        REFUTES: 0.0791,
        "NOT ENOUGH INFO": 0.067,
      },
      {
        text: "[Earth's orbit] From the same vantage point , both the Earth and the Sun would appear to rotate in a counterclockwise direction about their respective axes .",
        SUPPORTS: 0.6655,
        REFUTES: 0.196,
        "NOT ENOUGH INFO": 0.1385,
      },
    ],
    abstained: false,
    abstention_reason: null,
  },
  {
    claim: "Paris is the capital of France.",
    predicted_label: "SUPPORTS",
    confidence: 0.9599,
    evidence_used: [
      "[Paris] Paris -LRB- French pronunciation : -LSB- pɑʁi -RSB- , -LSB- paʁi -RSB- -RRB- is the capital and most populous city of France .",
    ],
    evidence_scores: [
      {
        text: "[Paris] Paris -LRB- French pronunciation : -LSB- pɑʁi -RSB- , -LSB- paʁi -RSB- -RRB- is the capital and most populous city of France .",
        SUPPORTS: 0.9599,
        REFUTES: 0.0231, // PLACEHOLDER
        "NOT ENOUGH INFO": 0.017, // PLACEHOLDER
      },
    ],
    abstained: false,
    abstention_reason: null,
  },
  {
    claim: "The Eiffel Tower is located in Berlin.",
    predicted_label: "REFUTES",
    confidence: 0.9595,
    evidence_used: [
      // PLACEHOLDER: frase non presa dall'output reale
      "[Eiffel Tower] The Eiffel Tower -LRB- tour Eiffel -RRB- is a wrought iron lattice tower on the Champ de Mars in Paris , France .",
    ],
    evidence_scores: [
      {
        text: "[Eiffel Tower] The Eiffel Tower -LRB- tour Eiffel -RRB- is a wrought iron lattice tower on the Champ de Mars in Paris , France .",
        SUPPORTS: 0.0212, // PLACEHOLDER
        REFUTES: 0.9595,
        "NOT ENOUGH INFO": 0.0193, // PLACEHOLDER
      },
    ],
    abstained: false,
    abstention_reason: null,
  },
  {
    claim: "Albert Einstein secretly disliked the taste of coffee.",
    predicted_label: "NOT ENOUGH INFO",
    confidence: 0.7011,
    evidence_used: [],
    evidence_scores: [
      {
        // PLACEHOLDER: frase e probabilità inventate (coerenti con confidence = 1 - 0.2989)
        text: "[Albert Einstein] Albert Einstein was a German-born theoretical physicist who developed the theory of relativity .",
        SUPPORTS: 0.2989,
        REFUTES: 0.1544,
        "NOT ENOUGH INFO": 0.5467,
      },
    ],
    abstained: true,
    abstention_reason: "No sentence provided sufficiently strong directional evidence",
  },
];
