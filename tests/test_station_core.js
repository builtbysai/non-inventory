'use strict';
const assert=require('node:assert/strict'),UI=require('../extension/station-core.js');
assert.deepEqual(UI.visibleMode('station'),{hid:false,com:false,field:true});
assert.deepEqual(UI.visibleMode('hid'),{hid:true,com:false,field:false});
assert.deepEqual(UI.visibleMode('com'),{hid:false,com:true,field:false});
assert.equal(UI.missing({investigation:'found',repeat:1})[0],'Already found');
assert.match(UI.foundFeedback({investigation:'found',repeat:1,serial:'TEST123'}).message,/Last-seen/);
assert.deepEqual(UI.changedValues({'Found Notes':'old','Found Location':'Shelf 1'},{'Found Notes':'new','Found Location':'Shelf 1'}),{'Found Notes':'new'});
console.log('PASS station: relevant mode controls, repeat feedback, and field-level detail patches');
