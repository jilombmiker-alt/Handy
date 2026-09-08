const {execFileSync}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'panel-modifier-test-'));
const executable=path.join(directory,'chord-test');
execFileSync('xcrun',['clang++','-std=c++17',path.resolve(__dirname,'../tests/modifier-chord.cpp'),'-o',executable],{stdio:'inherit'});
execFileSync(executable,[],{stdio:'inherit'});
console.log('PASS native chord state: both orders, exact left modifiers, third-key/mouse cancellation, long hold, no repeat. No physical keyboard input was simulated.');
