// All models to be syncronized
require('./liquidation_log');

const seq=require('./db');
// method 1:
// (async function(){
//     await seq.sync({alter:true});
//     console.log("All models are syncronized");
// }());

// method 2:
seq.sync({alter:true}).then(()=>{
    console.log("All models are syncronized");
});
