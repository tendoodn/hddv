/* AutoTax period K (customer-defined): sales / (sales + opening inventory).
 * Missing opening inventory, purchases and sales default to 1, not K=9.
 * Purchase totals remain visible in the report but are not part of this denominator.
 */
(()=>{
 'use strict';
 function parseStock(raw){
  const s=String(raw??'').trim().replace(/\s+/g,'');
  if(!s)return null;
  // Vietnamese thousands separators; decimal comma is supported.
  const n=Number(s.replace(/\./g,'').replace(',','.'));
  return Number.isFinite(n)&&n>=0?n:NaN;
 }
 function positiveOrOne(raw){
  const n=Number(raw);
  return Number.isFinite(n)&&n>0?n:1;
 }
 function calculate(buy,sold,raw){
  const purchase=positiveOrOne(buy),sales=positiveOrOne(sold);
  const parsedStock=parseStock(raw);
  if(Number.isNaN(parsedStock))return {value:null,mode:'invalid',purchase,sales,stock:null};
  const stock=parsedStock===null||parsedStock===0?1:parsedStock;
  const denominator=sales+stock;
  const defaulted=parsedStock===null||parsedStock===0||!(Number(buy)>0)||!(Number(sold)>0);
  return {value:sales/denominator,mode:defaulted?'defaulted':'calculated',purchase,sales,stock,denominator};
 }
 window.AutoTaxPeriodK=Object.freeze({parseStock,calculate});
})();
