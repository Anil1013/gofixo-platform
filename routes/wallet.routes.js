const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');

function asMoney(value){ const n=Number(value); if(!Number.isFinite(n)||n<=0||n>1000000)return null; return Number(n.toFixed(2)); }

async function ensureWallet(client, customerId){
  await client.query('INSERT INTO wallets (customer_id) VALUES ($1) ON CONFLICT (customer_id) DO NOTHING',[customerId]);
  const result=await client.query('SELECT * FROM wallets WHERE customer_id=$1 FOR UPDATE',[customerId]);
  return result.rows[0];
}

router.get('/', requireAuth(['customer']), async (req,res,next)=>{
  const client=await pool.connect();
  try{ await client.query('BEGIN'); const wallet=await ensureWallet(client,req.user.id); await client.query('COMMIT');
    res.json({id:wallet.id,customer_id:wallet.customer_id,available_balance:Number(wallet.available_balance),reserved_balance:Number(wallet.reserved_balance),currency:wallet.currency,status:wallet.status});
  }catch(err){await client.query('ROLLBACK');next(err);}finally{client.release();}
});

router.get('/transactions', requireAuth(['customer']), async (req,res,next)=>{
  try{ const result=await pool.query(`SELECT wt.id,wt.booking_id,wt.type,wt.amount,wt.balance_before,wt.balance_after,wt.reserved_before,wt.reserved_after,wt.status,wt.reference_id,wt.created_at FROM wallet_transactions wt JOIN wallets w ON w.id=wt.wallet_id WHERE wt.customer_id=$1 ORDER BY wt.created_at DESC,wt.id DESC LIMIT 100`,[req.user.id]); res.json(result.rows); }catch(err){next(err);}
});

// Creates a pending payment intent only. It never credits the wallet.
// Cashfree webhook integration will convert a verified successful payment into TOPUP later.
router.post('/topup-intent', requireAuth(['customer']), async (req,res,next)=>{
  const amount=asMoney(req.body?.amount); if(amount===null)return res.status(400).json({error:'amount must be between ₹0.01 and ₹1000000'});
  const referenceId='WALLET_TOPUP_'+req.user.id+'_'+Date.now()+'_'+crypto.randomBytes(5).toString('hex');
  const client=await pool.connect();
  try{ await client.query('BEGIN'); const wallet=await ensureWallet(client,req.user.id);
    const tx=await client.query(`INSERT INTO wallet_transactions (wallet_id,customer_id,type,amount,balance_before,balance_after,reserved_before,reserved_after,status,reference_id,metadata) VALUES ($1,$2,'TOPUP',$3,$4,$4,$5,$5,'pending',$6,$7) RETURNING id,reference_id,status,amount,created_at`,[wallet.id,req.user.id,amount,Number(wallet.available_balance),Number(wallet.reserved_balance),referenceId,JSON.stringify({provider:'cashfree',stage:'intent'})]);
    await client.query('COMMIT'); res.status(201).json({message:'Payment intent created. Wallet will be credited only after verified payment-provider confirmation.',payment_provider:'cashfree',transaction:tx.rows[0]});
  }catch(err){await client.query('ROLLBACK');next(err);}finally{client.release();}
});

module.exports=router;