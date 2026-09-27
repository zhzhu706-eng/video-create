import fs from 'node:fs/promises';
import path from 'node:path';

const [email,kind,amountText]=process.argv.slice(2);
const allowed=['projects','exportsPerMonth','videoSeconds'];
const amount=Number(amountText);
if(!email||!allowed.includes(kind)||!Number.isInteger(amount)||amount<0){
  console.error('Usage: node tools/grant-quota.mjs EMAIL projects|exportsPerMonth|videoSeconds AMOUNT');
  process.exit(2);
}
const file=path.join(process.env.DATA_ROOT||path.resolve('.'),'private','accounts.json');
const data=JSON.parse(await fs.readFile(file,'utf8'));
const account=data.accounts.find(a=>a.email===email.toLowerCase());
if(!account)throw new Error('Account not found');
account.quota[kind]=amount;
await fs.writeFile(file,JSON.stringify(data,null,2),{mode:0o600});
console.log(`${account.email}: ${kind}=${amount}`);
