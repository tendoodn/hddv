/* AutoTax K: sales / (purchases + opening inventory).
 * Missing inputs use 1 by user preference; an explicitly entered zero stock is zero.
 * Warning thresholds are product reference levels, not a legal determination.
 */
(()=>{
 'use strict';
 function parseStock(raw){
  const s=String(raw??'').trim().replace(/\s+/g,'');
  if(!s)return null;
  const n=Number(s.replace(/\./g,'').replace(',','.'));
  return Number.isFinite(n)&&n>=0?n:NaN;
 }
 function positiveOrOne(value){
  const n=Number(value);
  return Number.isFinite(n)&&n>0?n:1;
 }
 function calculate(buy,sold,raw){
  const purchase=positiveOrOne(buy),sales=positiveOrOne(sold),parsedStock=parseStock(raw);
  if(Number.isNaN(parsedStock))return {value:null,mode:'invalid',purchase,sales,stock:null};
  const stock=parsedStock===null?1:parsedStock;
  const denominator=purchase+stock;
  const defaulted=parsedStock===null||!(Number(buy)>0)||!(Number(sold)>0);
  return {value:sales/denominator,mode:defaulted?'defaulted':'calculated',purchase,sales,stock,denominator};
 }
 function threshold(industry){return industry==='production'?4:2}
 function shouldWarn(result,industry){return Number.isFinite(result?.value)&&result.value>=threshold(industry)}
 window.AutoTaxPeriodK=Object.freeze({parseStock,calculate,threshold,shouldWarn});
})();
