// Collectible lore fragments, relics and codex copy.
export const LORE = {
  l_gate1: { id: 'l_gate1', chamber: 'gate', title: 'Scratched into the Lintel', text: 'Emberhollow kept a flame for a thousand years so the dead could rest. Then the flame went out, and the dead stopped resting. If you read this, you came to relight it. Do not trust the quiet.' },
  l_gate2: { id: 'l_gate2', chamber: 'gate', title: 'A Gatekeeper\'s Ledger', text: 'Ash on the stair again. Third night this week. The Bishop says it is only the censer smoke. The Bishop has not left the Sanctum since the Vigil failed.' },
  l_nave1: { id: 'l_nave1', chamber: 'nave', title: 'Three Sockets', text: 'Three sigils open the Sanctum: Ash for what burned, Bone for what remained, Mourning for those who stayed. Bring them to the door and the seal will remember its own.' },
  l_nave2: { id: 'l_nave2', chamber: 'nave', title: 'Choir Notes', text: 'We sang the Vigil each dusk. When the Bishop took the censer he told us to stop singing, because the flame could hear. I think he meant it could hear us leaving.' },
  l_embers1: { id: 'l_embers1', chamber: 'embers', title: 'Order of the Hours', text: 'Light the crescent first, for the moon watched before the sun. Then the flame-spire, then the eye, and last the hollow ring. Out of order, the braziers grow jealous.' },
  l_embers2: { id: 'l_embers2', chamber: 'embers', title: 'Burnt Hymnal', text: 'Every page is scorched except one line: "A flame is only a promise that someone will return."' },
  l_ossuary1: { id: 'l_ossuary1', chamber: 'ossuary', title: 'Sexton\'s Note', text: 'Two coffins, two plates, one patient sexton. Push, never pull. When the stones disagree with you, the rune at the back of the hall will set them right again.' },
  l_ossuary2: { id: 'l_ossuary2', chamber: 'ossuary', title: 'Rattling Epitaph', text: 'Here lie the Bishop\'s choir. They did not die of the cold. They died of being asked to stay quiet.' },
  l_reliquary1: { id: 'l_reliquary1', chamber: 'reliquary', title: 'The Glyphs Remember', text: 'The four glyphs hum in turn. Listen, then answer in kind. The Reliquary has no patience for the impatient, only for the attentive.' },
  l_reliquary2: { id: 'l_reliquary2', chamber: 'reliquary', title: 'Warden\'s Last Entry', text: 'He took my sigil and called it a mercy. The Mourning lies behind the glyphs, and a Gravebrute guards it, because someone had to.' },
  l_sanctum1: { id: 'l_sanctum1', chamber: 'sanctum', title: 'Valdric\'s Confession', text: 'I did not put out the flame. I held it so tightly it died in my hands. A bishop who cannot let go is only a door that will not close.' },
};

export const RELICS = {
  r_gate: { id: 'r_gate', chamber: 'gate', name: 'Gatekeeper\'s Key-Ring', text: 'A ring of keys to doors that no longer exist.' },
  r_nave: { id: 'r_nave', chamber: 'nave', name: 'Choirboy\'s Whistle', text: 'Cracked, but it still sings one clear note.' },
  r_embers: { id: 'r_embers', chamber: 'embers', name: 'Unburnt Wick', text: 'It will not take a flame. It remembers one.' },
  r_ossuary: { id: 'r_ossuary', chamber: 'ossuary', name: 'Sexton\'s Lantern', text: 'Lit by nothing, warm to hold.' },
  r_reliquary: { id: 'r_reliquary', chamber: 'reliquary', name: 'Mourner\'s Veil', text: 'Black lace, dry for a thousand years.' },
};

export const SIGILS = {
  ash: { id: 'ash', name: 'Sigil of Ash', text: 'For what burned.' },
  bone: { id: 'bone', name: 'Sigil of Bone', text: 'For what remained.' },
  mourning: { id: 'mourning', name: 'Sigil of Mourning', text: 'For those who stayed.' },
};

export const STORY = {
  title: 'EMBERHOLLOW',
  tagline: 'Relight the Vigil',
  intro: [
    'Emberhollow kept a single flame alive for a thousand years, so that the dead might rest.',
    'The flame went out. The dead did not stay quiet.',
    'Beneath the drowned abbey, Bishop Valdric Orm still stands vigil over the ash. Find the three sigils. Open the Sanctum. Bring back the light.',
  ],
  victory: ['The Hollow Bishop crumbles, and the censer falls silent at last.', 'In the Sanctum, a small flame gutters, catches, and holds.', 'Emberhollow remembers its name.'],
};
