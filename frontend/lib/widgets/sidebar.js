var ui = require('../ui'),
    config = require('../config'),
    queryService = require('../service').query,
    stateCodes = require('../gameplay').stateCodes,
    container = require('./container'),
    gameplay = require('../setup').gameplay,
    operateAsync = require('operate_async').operateAsync,
    css = require('css');

var serverTime = 0;
    select = null,
    setDirective = setWidgetContent.bind(null,'directive'),
    setOnlinePlayerCt = setWidgetContent.bind(null,'online'),
    setOpponent = setWidgetContent.bind(null,'opponent'),
    setCaptureTable = setWidgetContent.bind(null,'capturetable'),
    setButtonSet = setWidgetContent.bind(null,'buttonset'),
    setLogs = setWidgetContent.bind(null,'logs'),
    setMoves = setWidgetContent.bind(null,'moves');

var blockResizeTimer;

function getChildren(){
  return [
    { 'name':'logs', 'module':require('./logs') },
    { 'name':'moves', 'module':require('./moves') },
    { 'name':'capturetable', 'module':require('./capturetable') },
    { 'name':'directive', 'module':require('./directive') },
    { 'name':'buttonset', 'module':require('./buttonset') }
  ]
}

function getSize(options){

  !options && ( options = container.layout );
    
  var el = select(), width, height, micro;

  micro = ( options.horizontal && options.viewport.width - options.boardWrapperSize.width < options.boardWrapperSize.width/3.5 ) ||
          ( options.vertical && options.viewport.height - options.boardWrapperSize.height  <  options.boardWrapperSize.height/5 );

  width = options.vertical || micro ? options.boardWrapperSize.width : options.viewport.width - options.boardWrapperSize.width;
  height = options.horizontal && !micro ? options.boardWrapperSize.height : options.viewport.height - options.boardWrapperSize.height;

  return {
    'height':height,
    'width':width,
    'micro':micro
  }
}

function render(callback){
  return ui.getTemplate('sidebar.html',function(error,template){
    if(error){
      return callback(error);
    }

    callback(error,ui.render(template));

  });
}

function resize(layout){
  !layout && ( layout = container.layout );
  var el = select();

  el.style.width = layout.sidebarSize.width+'px';
  el.style.height = layout.sidebarSize.height+'px';

  el.style.marginTop = layout.horizontal ? layout.captionListSize+'px' : '';

  if(blockResizeTimer!=undefined){
    clearTimeout(blockResizeTimer);
  }

  blockResizeTimer = setTimeout(resizeBlocks, 100,undefined);
}

function resizeBlocks(layout){
  !layout && ( layout = container.layout );

  if(layout.sidebarSize.micro){
    return;
  }

  var sidebarEl = select(),
      statusEl = select('#sidebar-status-widgetset'),
      sessionInfoEl = select('#sidebar-sessioninfo-widgetset'),
      sessionInfoContentEl = select('#sidebar-sessioninfo-widgetset-inner'),
      buttonsEl = select('#buttonset-widget'),
      footerEl = container.select('#footer'),
      movesEl, movesContentEl,
      logsEl, logsContentEl,
      capturesEl, capturesContainerEl, capturesContentEl,
      overflow, availWidth, availHeight,
      capturesPercent, movesPercent, logsPercent, contentHeight;

  if(!layout.sidebarSize.micro && layout.vertical){
    availWidth = sidebarEl.clientWidth - ( statusEl.offsetWidth + buttonsEl.offsetWidth + 20 );
    availHeight = sidebarEl.clientHeight - 10;

    sessionInfoEl.style.width = availWidth + 'px';
    sessionInfoEl.style.height = availHeight + 'px';

  } else if(!layout.sidebarSize.micro && layout.horizontal) {
    availWidth = sidebarEl.clientWidth - 10;
    availHeight = sidebarEl.clientHeight - ( statusEl.offsetHeight + buttonsEl.offsetHeight + footerEl.offsetHeight + 20 );
    sessionInfoEl.style.width = availWidth + 'px';
    sessionInfoEl.style.height = availHeight + 'px';
  }

  movesContentEl = select('#moves-list');
  logsContentEl = select('#logs-list');
  capturesContainerEl = select('#capturetable-content');

  capturesContainerEl && ( capturesContainerEl.style.height = '' );
  movesContentEl && ( movesContentEl.style.marginTop = '' );
  logsContentEl && ( logsContentEl.style.marginTop = '' );

  overflow = sessionInfoContentEl.offsetHeight - sessionInfoEl.clientHeight;

  if(overflow>0){
    movesEl = select('#moves-widget');
    logsEl = select('#logs-widget');
    capturesEl = select('#capturetable-widget');
    capturesContentEl = select('#capturetable-piece-list');

    contentHeight = 0
                  + ( capturesContentEl ? capturesContentEl.offsetHeight : 0 )
                  + ( movesContentEl ? movesContentEl.offsetHeight : 0 )
                  + ( logsContentEl ? logsContentEl.offsetHeight : 0 );

    if(capturesContentEl){
      capturesPercent = Math.round(capturesContentEl.offsetHeight*100/contentHeight);
      capturesContainerEl.style.height = capturesContentEl.offsetHeight-Math.round(overflow*capturesPercent/100)+'px';
    }

    if(movesContentEl){
      movesPercent = Math.round(movesContentEl.offsetHeight*100/contentHeight);
      movesContentEl.style.marginTop = Math.round(overflow*movesPercent/100)*-1+'px';
    }
    
    if(logsContentEl){
      logsPercent = Math.round(logsContentEl.offsetHeight*100/contentHeight);
      logsContentEl.style.marginTop = Math.round(overflow*logsPercent/100)*-1+'px';
    }

  }

}

function setup(){
  var children = getChildren(), i, len;
  for(i = -1, len=children.length; ++i < len; ){
    children[i].module.setup();
  };

  select = module.exports.select = ui.queryFragment.bind(null, ui.select('#sidebar'));
  container.events.subscribe('resize', resize);

  updateOnlinePlayerCt();
  setOpponent();
  gameplay.session.on('update', function(){
    updateOpponentStatus();
  });
}

function setWidgetContent(widgetName,value){
  var widget = select('#'+widgetName+'-widget'),
      valbox  = select('#'+widgetName+'-content'),
      sidebar, width, height;

  if(value && valbox.innerHTML!=value){
    sidebar = select(),
    width = sidebar.offsetWidth,
    height = sidebar.offsetHeight;

    valbox.innerHTML = value;
    widget.style.display = '';

    resize();
  } else if(!value) {
    widget.style.display = 'none';
  }

}

function updateOnlinePlayerCt(){
  var player = !gameplay.session.singleplayer && gameplay.getSelf();
  queryService(player&&'POST'||'GET', 'players/online', player && { 'spId':player.id } || null,function(error, result){
    if(error) throw error;
    serverTime = result.serverTime;

    setOnlinePlayerCt(result.online_player_count);

    updateOpponentStatus();

    setTimeout(updateOnlinePlayerCt, 3000);
  });
}

function updateOpponentStatus(){
  var opponent = gameplay.getOpponent(),
      self = gameplay.getSelf(),
      status = undefined,
      lag, sec, min, h, online;

  if(opponent){
    lag = Math.abs(self.last_move_ts-opponent.last_move_ts);
    sec = Math.floor(lag/1000);
    min = Math.floor(sec/60);
    h = Math.floor(min/60);
    online = min<=1;
    status = '<span class="'+(online&&'green'||'red')+'">'
           + ( online && 'Online' || 'Offline' )
           + ' ('
           + ( h ? h+'h' : ( min && (min+'min') || sec+'s' ) )
           + ')'
           + '</span>'
  }
  
  setOpponent(status);
}

module.exports = {
  'getSize':getSize,
  'render':render,
  'setButtonSet':setButtonSet,
  'setCaptureTable':setCaptureTable,
  'setDirective':setDirective,
  'setLogs':setLogs,
  'setMoves':setMoves,
  'setOnlinePlayerCt':setOnlinePlayerCt,
  'setOpponent':setOpponent,
  'setup':setup,
  'updateOnlinePlayerCt':updateOnlinePlayerCt,
  'updateOpponentStatus':updateOpponentStatus
}