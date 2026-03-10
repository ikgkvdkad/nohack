const ADJECTIVES = [
  'Bold', 'Brave', 'Bright', 'Calm', 'Clear', 'Cold', 'Cool', 'Crimson',
  'Dark', 'Dawn', 'Deep', 'Dusk', 'Ember', 'Fair', 'Faint', 'Feral',
  'Fierce', 'Fleet', 'Fog', 'Frost', 'Ghost', 'Gold', 'Grand', 'Gray',
  'Haze', 'Hidden', 'Hollow', 'Hushed', 'Idle', 'Iron', 'Ivory', 'Keen',
  'Last', 'Lone', 'Lost', 'Lucky', 'Lunar', 'Misty', 'Moss', 'Mute',
  'Noble', 'North', 'Odd', 'Old', 'Pale', 'Pine', 'Proud', 'Quiet',
  'Rapid', 'Rare', 'Raven', 'Red', 'Ridge', 'Roam', 'Rogue', 'Rust',
  'Sage', 'Salt', 'Sand', 'Shadow', 'Sharp', 'Silent', 'Silver', 'Slate',
  'Sleek', 'Slow', 'Smoke', 'Snow', 'Solar', 'South', 'Steel', 'Still',
  'Stone', 'Storm', 'Stray', 'Summer', 'Swift', 'Thorn', 'Tidal', 'True',
  'Vast', 'Velvet', 'Vivid', 'Warm', 'West', 'White', 'Wild', 'Winter',
  'Wren', 'Zinc',
];

const NOUNS = [
  'Badger', 'Bear', 'Birch', 'Bison', 'Brook', 'Cedar', 'Cliff', 'Cloud',
  'Cobra', 'Coral', 'Crane', 'Creek', 'Crow', 'Dagger', 'Deer', 'Dove',
  'Drift', 'Dune', 'Eagle', 'Echo', 'Elk', 'Ember', 'Falcon', 'Fern',
  'Finch', 'Flint', 'Fox', 'Gale', 'Gem', 'Glen', 'Gorge', 'Grove',
  'Gull', 'Hare', 'Hawk', 'Heron', 'Hill', 'Hollow', 'Hound', 'Isle',
  'Ivy', 'Jade', 'Jay', 'Kestrel', 'Lake', 'Lark', 'Leaf', 'Ledge',
  'Leopard', 'Lily', 'Linden', 'Lion', 'Lynx', 'Maple', 'Marsh', 'Meadow',
  'Mink', 'Moon', 'Moth', 'Oak', 'Orchid', 'Orca', 'Osprey', 'Otter',
  'Owl', 'Panda', 'Panther', 'Peak', 'Pearl', 'Pike', 'Plover', 'Pond',
  'Puma', 'Quail', 'Raven', 'Reef', 'Ridge', 'River', 'Robin', 'Rock',
  'Rose', 'Sage', 'Seal', 'Shrike', 'Sparrow', 'Spruce', 'Stag', 'Swan',
  'Tiger', 'Trail', 'Trout', 'Vale', 'Viper', 'Wander', 'Wolf', 'Wren',
];

export function generateDeviceName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 90 + 10); // 10–99
  return `NoHack ${adj}${noun}${num}`;
}

// Derive a deterministic human-readable name from a public key
export function keyToName(publicKey: string): string {
  let hash = 0;
  for (let i = 0; i < publicKey.length; i++) {
    hash = ((hash << 5) - hash + publicKey.charCodeAt(i)) | 0;
  }
  hash = Math.abs(hash);

  const adj = ADJECTIVES[hash % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(hash / ADJECTIVES.length) % NOUNS.length];
  const num = (hash % 900) + 100; // 100–999
  return `${adj}${noun}${num}`;
}
