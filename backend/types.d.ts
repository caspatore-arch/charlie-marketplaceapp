// The Expo tsconfig base does not pull in Node's ambient types, and the
// backend cannot edit tsconfig.json. This reference makes @types/node visible
// to every file under backend/ and scripts/.
/// <reference types="node" />
