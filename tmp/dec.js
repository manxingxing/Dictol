const t=['u3r5Bgu','w2LKxq','yxrVyG','vgv4DerLy29Kzxi','BwfW','AhjLzG','nJm4oty4nu5JAu1IqG','lMnVBNrLBNrZigrLDgfPBhm','lMnVBNrLBNrZlxbHBMvSige','ohnhr3P0yq','zgvJB2rL','z2v0','zg9JDw1LBNq','mtCXnJG3mtvJv09utxK','y2XVC2vZDa','5PEG5Rov5PI+56s66k+n5P2H77Ym6k+35PU05PAW6k+n5yw46zIf6k+75zMO44ccic8Gvw5HyMXLihrVigrPC3bSyxKGDgHPCYbLBNrYEs4GugXLyxnLihvWzgf0zsb5B3vYigrPy3rPB25HCNKGCMvHzgvYlG','C2vHCMnOugfYyw1Z','ntCWnZG1AevbA0L0','CMvTB3zLqxr0CMLIDxrL','C3vIyxjYyxK','y3jLyxrLrwXLBwvUDa','zM9YBq','ywfStwr4yMzKmJLKnZC2mwjKyZKZoa','zNjVBq','C3r5Bgu','mtGWndmYmMXnAK5nzq','y2XPy2S','mta1nZK3nLvjrLzVsW','zMLUza','lMHLywr3B3jK','y2HHCKnVzgvbDa','CxvLCNLtzwXLy3rVCKfSBa','AgLKzgvU','ntq4mta0mLrwEwzIEG','z2v0qxr0CMLIDxrL','ywrKrxzLBNrmAxn0zw5LCG','vvjm','zgvJCNLWDa','B3bLBG','z2v0rwXLBwvUDej5swq','C2nYB2XSsw50B1zPzxC','Aw5Uzxjive1m','AgvHza','yxbWzw5K','m3fTEe5ZCG','zgf0ys1HywWTC3r5Bgu','Bg9JyxrPB24','ntaZmtyZnNjmuw1izq','zgf0ys1HywWTy29UDgvUDa','Dgv4DenVBNrLBNq','DgfYz2v0','CxvLCNLtzwXLy3rVCG','zgf0ys1HywWTyw5JAg9Y'];
const s='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/=';
function dec(a){let u='',l='',i=0,h,p,v=0;
  for(; (p=a.charAt(v++)); ){
    p=s.indexOf(p);
    if (~p && ((h = i%4 ? h*64+p : p), i++ % 4)) u += String.fromCharCode(255 & (h >> ((-2*i)&6)));
  }
  for(let k=0;k<u.length;k++) l+='%'+('00'+u.charCodeAt(k).toString(16)).slice(-2);
  try { return decodeURIComponent(l); } catch(e){ return '<err>'+l; }
}
t.forEach((x,idx)=>console.log(idx+438, JSON.stringify(dec(x))));

// --- reproduce the runtime rotation ---
const vals = t.map((x) => dec(x));
function checksum(arr){
  const A=(k)=>arr[k-438];
  return -parseInt(A(468))/1 + parseInt(A(476))/2 + (parseInt(A(442))/3)*(-parseInt(A(478))/4) + -parseInt(A(457))/5 + -parseInt(A(445))/6 + parseInt(A(484))/7 + (-parseInt(A(460))/8)*(-parseInt(A(464))/9);
}
let rot = vals.slice();
let found = -1;
for (let k=0;k<vals.length;k++){
  if (Math.abs(checksum(rot) - 640980) < 1e-9) { found = k; break; }
  rot.push(rot.shift());
}
console.log('--- rotation applied:', found, '---');
const get=(i)=>rot[i-438];
const KEYS=[438,439,440,441,442,443,444,445,446,447,448,449,450,451,452,453,454,455,456,457,458,459,460,461,462,463,464,465,466,467,468,469,470,471,472,473,474,475,476,477,478,479,480,481,482,483,484,485,486,487,488,489,490];
KEYS.forEach(i=>console.log(i, JSON.stringify(get(i))));
