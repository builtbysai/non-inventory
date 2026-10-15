document.querySelector('#open').addEventListener('click',()=>browser.tabs.create({url:browser.runtime.getURL('station.html')}));
