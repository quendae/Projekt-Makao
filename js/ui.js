import { JACK_DEMAND_RANKS, SUITS } from './constants.js';
import { cardLabel, getTurnConstraint, isCardLegal, suitLabel, suitSymbol, validateGroup } from './rules.js';

export class MakaoUI {
  constructor(game) {
    this.game = game;
    this.selected = new Set();
    this.botCount = 2;
    this.helperTab = 'state';
    this.lastToastTimer = null;
    this.bindElements();
    this.bindEvents();
  }

  bindElements() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hudTurn: $('hud-turn'), hudDeck: $('hud-deck'), hudState: $('hud-state'), phaseRibbon: $('phase-ribbon'), opponents: $('opponents'), drawCount: $('draw-count'), discard: $('discard-pile'), centerState: $('center-state'), humanSeat: $('human-seat'), humanRole: $('human-role'), humanCount: $('human-count'), hand: $('human-hand'), actionBar: $('action-bar'), makaoBtn: $('makao-btn'), clearBtn: $('clear-btn'), playBtn: $('play-btn'), drawBtn: $('draw-btn'), passBtn: $('pass-btn'), helperContent: $('helper-content'), mainMenu: $('main-menu'), startBtn: $('start-btn'), resumeBtn: $('resume-btn'), botSelector: $('bot-selector'), menuBtn: $('menu-btn'), rulesBtn: $('rules-btn'), menuRulesBtn: $('menu-rules-btn'), rulesModal: $('rules-modal'), rulesClose: $('rules-close'), choiceModal: $('choice-modal'), choiceEyebrow: $('choice-eyebrow'), choiceTitle: $('choice-title'), choiceDescription: $('choice-description'), choiceOptions: $('choice-options'), resultModal: $('result-modal'), standings: $('standings'), resultNewGame: $('result-new-game'), toast: $('toast'), motionToggle: $('motion-toggle')
    };
  }

  bindEvents() {
    this.el.botSelector.addEventListener('click', (event) => {
      const button = event.target.closest('[data-bots]');
      if (!button) return;
      this.botCount = Number(button.dataset.bots);
      this.el.botSelector.querySelectorAll('.segment').forEach((item) => item.classList.toggle('active', item === button));
    });
    this.el.startBtn.addEventListener('click', () => { this.selected.clear(); this.closeMenu(); this.game.start(this.botCount); });
    this.el.resumeBtn.addEventListener('click', () => this.closeMenu());
    this.el.menuBtn.addEventListener('click', () => this.openMenu());
    this.el.rulesBtn.addEventListener('click', () => this.openRules());
    this.el.menuRulesBtn.addEventListener('click', () => this.openRules());
    this.el.rulesClose.addEventListener('click', () => this.closeRules());
    this.el.rulesModal.addEventListener('click', (event) => { if (event.target === this.el.rulesModal) this.closeRules(); });
    document.querySelectorAll('.helper-tab').forEach((tab) => tab.addEventListener('click', () => { this.helperTab = tab.dataset.tab; document.querySelectorAll('.helper-tab').forEach((button) => button.classList.toggle('active', button === tab)); this.renderHelper(this.game.state); }));
    this.el.hand.addEventListener('click', (event) => { const cardEl = event.target.closest('[data-card-id]'); if (!cardEl || cardEl.classList.contains('disabled-card')) return; this.toggleCardSelection(cardEl.dataset.cardId); });
    this.el.clearBtn.addEventListener('click', () => { this.selected.clear(); this.render(this.game.state); });
    this.el.playBtn.addEventListener('click', () => { const result = this.game.humanPlay([...this.selected]); if (!result.ok) this.showToast(result.reason); });
    this.el.drawBtn.addEventListener('click', () => this.game.humanDraw());
    this.el.passBtn.addEventListener('click', () => this.game.humanPassAfterDraw());
    this.el.makaoBtn.addEventListener('click', () => this.game.toggleMakao());
    this.el.motionToggle.addEventListener('change', () => document.body.classList.toggle('reduce-motion', !this.el.motionToggle.checked));
    this.el.resultNewGame.addEventListener('click', () => { this.el.resultModal.classList.remove('open'); this.openMenu(); });
  }

  openMenu(){ this.el.mainMenu.classList.add('open'); this.el.resumeBtn.classList.toggle('hidden', !(this.game.state.started && !this.game.state.gameOver)); }
  closeMenu(){ this.el.mainMenu.classList.remove('open'); }
  openRules(){ this.el.rulesModal.classList.add('open'); }
  closeRules(){ this.el.rulesModal.classList.remove('open'); }
  showToast(message){ clearTimeout(this.lastToastTimer); this.el.toast.textContent=message; this.el.toast.classList.add('show'); this.lastToastTimer=setTimeout(()=>this.el.toast.classList.remove('show'),2600); }

  toggleCardSelection(cardId){
    if(!this.game.humanCanAct())return;
    const state=this.game.state, human=state.players[state.currentIndex], card=human.hand.find((item)=>item.id===cardId); if(!card)return;
    if(state.drawnRescueCardId){this.selected.clear();this.selected.add(cardId);this.render(state);return;}
    if(this.selected.has(cardId)){this.selected.delete(cardId);this.render(state);return;}
    const selectedCards=[...this.selected].map((id)=>human.hand.find((item)=>item.id===id)).filter(Boolean);
    if(selectedCards.length&&selectedCards[0].rank!==card.rank)this.selected.clear();
    if(this.selected.size<4)this.selected.add(cardId); this.render(state);
  }

  render(state){ this.pruneSelection(state); this.renderHud(state); this.renderOpponents(state); this.renderCenter(state); this.renderHuman(state); this.renderActions(state); this.renderHelper(state); this.renderChoice(state); this.renderResult(state); }

  pruneSelection(state){
    const human=state.players.find((player)=>player.isHuman);
    if(!human||state.currentIndex!==state.players.indexOf(human)||human.finishPlace!=null){this.selected.clear();return;}
    const ids=new Set(human.hand.map((card)=>card.id)); for(const id of this.selected)if(!ids.has(id))this.selected.delete(id);
    if(state.drawnRescueCardId)for(const id of [...this.selected])if(id!==state.drawnRescueCardId)this.selected.delete(id);
  }

  renderHud(state){
    if(!state.started){this.el.hudTurn.textContent='—';this.el.hudDeck.textContent='52';this.el.hudState.textContent='OCZEKIWANIE';return;}
    const current=state.players[state.currentIndex]; this.el.hudTurn.textContent=current?.name?.toUpperCase()??'—'; this.el.hudDeck.textContent=String(state.drawPile.length); this.el.hudState.textContent=this.constraintShort(state).toUpperCase();
  }

  renderOpponents(state){
    this.el.opponents.innerHTML=''; if(!state.started)return;
    const bots=state.players.filter((player)=>!player.isHuman), positions=bots.length===2?['seat-left','seat-right']:['seat-left','seat-top','seat-right'];
    bots.forEach((bot,idx)=>{
      const playerIndex=state.players.indexOf(bot), seat=document.createElement('div');
      seat.className=`opponent-seat ${positions[idx]} ${state.currentIndex===playerIndex&&!state.gameOver?'active':''} ${bot.finishPlace?'finished':''}`;
      const backs=Array.from({length:Math.min(bot.hand.length,6)},(_,cardIndex)=>`<span class="mini-back" style="--i:${cardIndex}"></span>`).join('');
      seat.innerHTML=`<div class="opponent-hand">${backs}<b>${bot.hand.length}</b></div><div class="player-plate"><div class="avatar avatar-${idx+1}">${bot.avatar}</div><div class="plate-copy"><strong>${bot.name}</strong><span>${bot.finishPlace?`${bot.finishPlace}. MIEJSCE`:'BOT'}</span></div><div class="card-counter">${bot.hand.length} KART</div></div>`;
      this.el.opponents.appendChild(seat);
    });
  }

  renderCenter(state){
    this.el.drawCount.textContent=String(state.drawPile.length||0); this.el.discard.innerHTML='';
    if(!state.started){this.el.phaseRibbon.textContent='Wybierz liczbę botów i rozpocznij grę';this.el.centerState.innerHTML='<span class="eyebrow">AKTUALNIE</span><strong>—</strong><small>Rozpocznij partię</small>';return;}
    const top=state.discardPile.at(-1); if(top)this.el.discard.appendChild(this.makeCard(top,{table:true})); this.el.phaseRibbon.textContent=this.phaseText(state);
    const current=state.players[state.currentIndex],detail=this.constraintDetail(state); this.el.centerState.innerHTML=`<span class="eyebrow">AKTUALNA TURA</span><strong>${current?.name??'—'}</strong><small>${detail}</small>`;
  }

  renderHuman(state){
    const human=state.players.find((player)=>player.isHuman); if(!human){this.el.hand.innerHTML='';this.el.humanCount.textContent='0 KART';return;}
    const humanIndex=state.players.indexOf(human); this.el.humanSeat.classList.toggle('active',state.currentIndex===humanIndex&&!state.gameOver&&!human.finishPlace);this.el.humanSeat.classList.toggle('finished',Boolean(human.finishPlace));
    this.el.humanRole.textContent=human.finishPlace?`${human.finishPlace}. MIEJSCE`:state.currentIndex===humanIndex?'TWOJA TURA':'GRACZ'; this.el.humanCount.textContent=`${human.hand.length} ${this.cardWord(human.hand.length)}`; this.el.hand.innerHTML='';
    const isHumanTurn=this.game.humanCanAct(),drawnId=state.drawnRescueCardId;
    human.hand.forEach((card,index)=>{
      const legal=isHumanTurn&&isCardLegal(card,state,humanIndex),isRescueAllowed=!drawnId||card.id===drawnId,cardEl=this.makeCard(card,{hand:true}); cardEl.dataset.cardId=card.id;
      const center=(human.hand.length-1)/2,delta=index-center; cardEl.style.setProperty('--angle',`${delta*2.35}deg`);cardEl.style.setProperty('--hover-angle',`${delta*1.7}deg`);cardEl.style.setProperty('--selected-angle',`${delta*1.2}deg`);cardEl.style.setProperty('--drop',`${Math.abs(delta)*1.25}px`);
      const selectedCards=[...this.selected].map((id)=>human.hand.find((held)=>held.id===id)).filter(Boolean),companion=selectedCards.length>0&&selectedCards[0].rank===card.rank&&selectedCards.length<4,canSelect=isRescueAllowed&&(legal||companion||this.selected.has(card.id));
      cardEl.classList.toggle('selected',this.selected.has(card.id));cardEl.classList.toggle('playable',canSelect);cardEl.classList.toggle('disabled-card',!canSelect);cardEl.classList.toggle('rescue-card',drawnId===card.id);cardEl.setAttribute('aria-label',cardLabel(card));this.el.hand.appendChild(cardEl);
    });
  }

  renderActions(state){
    const canAct=this.game.humanCanAct(),human=state.players.find((player)=>player.isHuman),humanIndex=human?state.players.indexOf(human):-1,selectedCards=human?[...this.selected].map((id)=>human.hand.find((card)=>card.id===id)).filter(Boolean):[],validation=canAct?validateGroup(selectedCards,state,humanIndex,{rescueOnly:Boolean(state.drawnRescueCardId)}):{ok:false},handAfter=human?human.hand.length-selectedCards.length:99,makaoRelevant=canAct&&validation.ok&&handAfter<=1,constraint=canAct?getTurnConstraint(state,humanIndex):{type:'normal'};
    this.el.playBtn.disabled=!canAct||!validation.ok;this.el.clearBtn.disabled=!this.selected.size;this.el.drawBtn.disabled=!canAct||Boolean(state.drawnRescueCardId);this.el.makaoBtn.disabled=!makaoRelevant;this.el.makaoBtn.classList.toggle('armed',state.makaoArmed);this.el.makaoBtn.textContent=handAfter===0?'MAKAO I PO MAKALE':'MAKAO';this.el.passBtn.classList.toggle('hidden',!state.drawnRescueCardId||!canAct);
    if(constraint.type==='draw')this.el.drawBtn.textContent=`Dobierz ${constraint.amount}`;else if(constraint.type==='skip')this.el.drawBtn.textContent=`Przyjmij blokadę (${constraint.count})`;else this.el.drawBtn.textContent='Dobierz kartę';
  }

  renderHelper(state){
    if(this.helperTab==='rules'){this.el.helperContent.innerHTML='<div class="helper-card"><span class="eyebrow">PODSTAWA</span><strong>Kolor lub wartość</strong><p>Możesz zagrać 1, 3 albo 4 karty tej samej wartości. Par i schodków nie ma.</p></div><div class="mini-rule-list"><p><b>2 / 3</b><span>dobieranie, kumulacja</span></p><p><b>4</b><span>utrata kolejki</span></p><p><b>J</b><span>żądanie 5–10</span></p><p><b>Q</b><span>dzika poza aktywną funkcją</span></p><p><b>A</b><span>żądanie koloru</span></p><p><b>K♥ / K♠</b><span>+5 następny / poprzedni</span></p></div>';return;}
    if(this.helperTab==='log'){this.el.helperContent.innerHTML=state.log.length?`<div class="log-list">${state.log.map((entry)=>`<p>${entry.message}</p>`).join('')}</div>`:'<div class="empty-helper">Dziennik pojawi się po rozpoczęciu gry.</div>';return;}
    if(!state.started){this.el.helperContent.innerHTML='<div class="helper-card"><span class="eyebrow">GOTOWOŚĆ</span><strong>Stół czeka</strong><p>W menu wybierz 2 lub 3 boty i rozpocznij partię.</p></div>';return;}
    const current=state.players[state.currentIndex],constraint=getTurnConstraint(state,state.currentIndex),standings=state.standings.length?state.standings.map((index,place)=>`<p><b>${place+1}.</b><span>${state.players[index].name}</span></p>`).join(''):'<p><span>Jeszcze nikt nie zakończył.</span></p>';
    this.el.helperContent.innerHTML=`<div class="helper-card emphasized"><span class="eyebrow">RUCH</span><strong>${current.name}</strong><p>${this.constraintDescription(constraint)}</p></div>${state.jackDemand?`<div class="status-chip"><span>Walet żąda</span><b>${state.jackDemand.rank}</b></div>`:''}${state.aceDemand?`<div class="status-chip"><span>As żąda</span><b>${suitSymbol(state.aceDemand.suit)} ${suitLabel(state.aceDemand.suit)}</b></div>`:''}${state.pendingDraw?`<div class="status-chip danger"><span>Kara</span><b>+${state.pendingDraw.amount}</b></div>`:''}${state.pendingSkip?`<div class="status-chip"><span>Blokada</span><b>${state.pendingSkip.count}</b></div>`:''}<div class="helper-subhead">KLASYFIKACJA</div><div class="ranking-mini">${standings}</div>`;
  }

  renderChoice(state){
    const choice=state.pendingChoice;if(!choice){this.el.choiceModal.classList.remove('open');return;}this.el.choiceOptions.innerHTML='';this.el.choiceModal.classList.add('open');
    if(choice.type==='jack'){this.el.choiceEyebrow.textContent='WALET';this.el.choiceTitle.textContent='Zażądaj wartości';this.el.choiceDescription.textContent='Wybierz wartość od 5 do 10.';for(const rank of JACK_DEMAND_RANKS){const button=document.createElement('button');button.className='choice-button rank-choice';button.textContent=rank;button.addEventListener('click',()=>this.game.choosePending(rank));this.el.choiceOptions.appendChild(button);}}
    else{this.el.choiceEyebrow.textContent='AS';this.el.choiceTitle.textContent='Zażądaj koloru';this.el.choiceDescription.textContent='Żądanie obowiązuje następnego gracza.';for(const suit of SUITS){const button=document.createElement('button');button.className=`choice-button suit-choice suit-${suit.key}`;button.innerHTML=`<b>${suit.symbol}</b><span>${suit.label}</span>`;button.addEventListener('click',()=>this.game.choosePending(suit.key));this.el.choiceOptions.appendChild(button);}}
  }

  renderResult(state){if(!state.gameOver){this.el.resultModal.classList.remove('open');return;}this.el.standings.innerHTML=state.standings.map((index,place)=>{const player=state.players[index];return`<div class="standing-row ${player.isHuman?'human-standing':''}"><b>${place+1}</b><span>${player.name}</span><small>${player.isHuman?'GRACZ':'BOT'}</small></div>`;}).join('');this.el.resultModal.classList.add('open');}

  makeCard(card,{hand=false,table=false}={}){const el=document.createElement('div');el.className=`card card-face suit-${card.suit} ${hand?'hand-card':''} ${table?'table-card':''}`;const symbol=suitSymbol(card.suit);el.innerHTML=`<div class="corner top-corner"><strong>${card.rank}</strong><span>${symbol}</span></div><div class="center-pip">${symbol}</div><div class="corner bottom-corner"><strong>${card.rank}</strong><span>${symbol}</span></div>`;return el;}
  phaseText(state){if(state.gameOver)return'Koniec partii';const current=state.players[state.currentIndex],constraint=getTurnConstraint(state,state.currentIndex);if(constraint.type==='draw')return`${current.name}: obrona albo +${constraint.amount}`;if(constraint.type==='skip')return`${current.name}: obrona czwórką albo blokada`;if(constraint.type==='jack')return`${current.name}: żądana wartość ${constraint.rank}`;if(constraint.type==='ace')return`${current.name}: żądany kolor ${suitLabel(constraint.suit)}`;if(state.drawnRescueCardId&&current.isHuman)return'Pierwsza karta ratuje';return`Ruch: ${current.name}`;}
  constraintShort(state){const c=getTurnConstraint(state,state.currentIndex);if(c.type==='draw')return`kara +${c.amount}`;if(c.type==='skip')return`blokada ${c.count}`;if(c.type==='jack')return`żądanie ${c.rank}`;if(c.type==='ace')return`kolor ${suitLabel(c.suit)}`;return'gra';}
  constraintDetail(state){return this.constraintDescription(getTurnConstraint(state,state.currentIndex));}
  constraintDescription(c){if(c.type==='draw')return`Zagraj 2/3 albo dobierz ${c.amount} kart.`;if(c.type==='skip')return`Zagraj 4 albo przyjmij ${c.count} ${c.count===1?'blokadę':'blokady'}.`;if(c.type==='jack')return`Obowiązuje żądanie wartości ${c.rank}.`;if(c.type==='ace')return`Obowiązuje kolor ${suitLabel(c.suit)} dla tej tury.`;return'Zagraj kartę pasującą kolorem lub wartością albo dobierz.';}
  cardWord(count){if(count===1)return'KARTA';if([2,3,4].includes(count%10)&&![12,13,14].includes(count%100))return'KARTY';return'KART';}
}
