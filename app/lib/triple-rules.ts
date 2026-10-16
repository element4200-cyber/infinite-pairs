export type PairSlot = {slot:number;mint:string;symbol:string};
export function nextPairSlot(tokens:PairSlot[]){
  const slots=tokens.map(t=>t.slot);
  if(slots.includes(2))return null;
  return slots.includes(1)?2:1;
}
export function pairPredecessor(root:{mint:string;symbol:string},tokens:PairSlot[],slot:number){
  if(slot!==1&&slot!==2)throw new Error('A group has only two pair slots. Start a new main coin.');
  if(tokens.some(t=>t.slot===slot))throw new Error('This pair slot is already filled.');
  if(slot===1)return root;
  const previous=tokens.find(t=>t.slot===1);
  if(!previous)throw new Error('Launch and finalize Pair 1 before creating Pair 2.');
  return previous;
}
