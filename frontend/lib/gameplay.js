var Observable = require('observer').Observable,
    Chess = require('chess').Chess,
    inherits = require('util').inherits,
    Session = require('./session').Session,
    player = require('./player'),
    history = require('./history'),
    queryService = require('./service').query;

function Gameplay(){
  Observable.call(this);

  this._stream_ = null;

  this.context = new Chess;
  this.serverTime = undefined;
  this.session = new Session;
  this.session.gameplay = this;
  this.state = 0;


  this.events.create('connect');
  this.events.create('disconnect');
  this.events.create('error');

  this.session.on('create', this.listenForOpponent.bind(this));
  this.session.on('update', this.checkRevisionUpdate.bind(this));
  this.session.on('update', this.checkGameState.bind(this));
}

inherits(Gameplay, Observable);

Gameplay.prototype.black = function(){
  return this.session.player('black', true);
};

Gameplay.prototype.checkGameState = function(){
  if(this.context.game_over()){
    this.state = stateCodes.END;
    this.session.events.publish('end');
  }
};

Gameplay.prototype.checkRevisionUpdate = function(){
  var turn, player; 

  if(this.state == stateCodes.PLAYING && !this.session.singleplayer){
    turn = this.context.turn() == 'w' && 'white' || 'black';
    player = this.getSelf();

    ( !player || !player[turn] ) && ( this.listenForMove() );
  }
}

Gameplay.prototype.createSession = function(options){
  this.state = stateCodes.CONNECTING;

  this._stream_ && this._stream_.abort();
  this.session.players = [];

  queryService('POST', 'session/new', options, function(error,response){
    if(error){
      this.state = stateCodes.UNINITIALIZED;
      return this.events.publish('error',new Error('Unsuccessful connection attempt. Server Response:"'+error.message+'"'));
    }

    this.state = response.players.length>1 ? stateCodes.PLAYING : stateCodes.WAITING_OPPONENT;
    this.session.importServiceResponse(response);
    this.events.publish('connect');

  }.bind(this));
};

Gameplay.prototype.getMove = function(from,to){
  var legalMoves = this.context.moves({ 'verbose':true }),
      move = undefined;

  for(var i = -1, len=legalMoves.length; ++i < len; ){
    if(legalMoves[i].from == from && legalMoves[i].to == to){
      move = legalMoves[i];
      break;
    }
  };

  return move;
};

Gameplay.prototype.getOpponent = function(){
  return this.session.player('id');
}

Gameplay.prototype.getSelf = function(){
  return this.session.player('id', undefined, 'string');
}

Gameplay.prototype.join = function(sessionId,nickname){
  this.state = stateCodes.CONNECTING;

  this.reset();

  var sessions = history.getSessions(),
      isExistentPlayer = sessions && sessions.hasOwnProperty(sessionId),
      options = isExistentPlayer ? { 'spId':sessions[sessionId] } : { 'nickname':nickname };

  queryService('POST', 'session/'+sessionId+'/join', options, function(error,response){
    if(error){
      this.state = stateCodes.UNINITIALIZED;
      return this.events.publish('error',new Error('Unsuccessful connection attempt. Server Response:"'+error.message+'"'));
    }

    this.state = response.players.length>1 ? stateCodes.PLAYING : stateCodes.WAITING_OPPONENT;
    this.session.importServiceResponse(response);
    this.events.publish('connect');

  }.bind(this));
}

Gameplay.prototype.listenForMove = function(){
  var id = this.session.id,
      player = this.getSelf(),
      rev = this.session.rev,
      body = { 'revision':rev };

  player && (body[ 'spId' ] = player.id);

  this._stream_ && this._stream_.abort();

  (function(){
    var tryAgain = arguments.callee.bind(this);
    this._stream_ = queryService('POST', 'session/'+id+'/listen/update',body,function(error, response){
      this._stream_ = null;
      if(error){
        this.events.publish('error', error);
        return;
      }

      this.session.importServiceResponse(response);
      !response.ok && tryAgain();

    }.bind(this));
  }).call(this);

}

Gameplay.prototype.listenForOpponent = function(){

  var sessionId = this.session.id,
      playerId  = this.getSelf().id;

  this._stream_ && this._stream_.abort();

  (function(){
    var tryAgain = arguments.callee.bind(this);
    this._stream_ = queryService('POST', 'session/'+sessionId+'/listen/opponent', { 'spId':playerId },function(error, response){
      this._stream_ = null;
      if(error){
        this.state = stateCodes.UNINITIALIZED;
        this.events.publish('error', error);
      } else if(response.ok) {
          this.state = stateCodes.PLAYING;
          this.session.importServiceResponse(response);
      } else {
        tryAgain();
      }
    }.bind(this));
  }).call(this);
};

Gameplay.prototype.makeMove = function(move){
  var player = this.getSelf(),
      sessionId = this.session.id;
  if( player && sessionId ){
    queryService('POST','session/'+sessionId+'/move',{ 'from':move.from, 'to':move.to, 'promotion':move.promotion, 'spId':player.id },function(error, response){
      if(response.ok){
        this.session.importServiceResponse(response);
      } else {
        this.events.publish('error', error);
      }
    }.bind(this));
  }
};

Gameplay.prototype.reset = function(){
  this._stream_ && this._stream_.abort();
  this.state = stateCodes.UNINITIALIZED;
  this.session.id = undefined;
  this.session.players = [];
  this.session.logs = [];
  this.session.moves = [];
  this.session.singleplayer = undefined;
  this.session.events.publish('leave');
};


Gameplay.prototype.start = function(nickname){ 
  this.state = stateCodes.CONNECTING;

  this.reset();

  var ignoreList = [],
      sessions = history.getSessions(),
      key;

  if(sessions){
    for(key in sessions){
      ignoreList.push(key);
    }
  }

  queryService('POST', 'session/start', { 'nickname':nickname, 'ignoreList':ignoreList }, function(error,response){
    if(error){
      return this.events.publish('error',new Error('Could not connect to the server'));
    }

    this.state = response.players.length>1 ? stateCodes.PLAYING : stateCodes.WAITING_OPPONENT;
    this.session.importServiceResponse(response);
    this.events.publish('connect');

  }.bind(this));
}

Gameplay.prototype.testPieceOwnership = function(square){
  var self = this.getSelf(),
      name = this.context.get(square);

  return self && name && self[name.toUpperCase()==name&&'white'||'black'];
}

Gameplay.prototype.white = function(){
  return this.session.player('white', true);
};

var stateCodes = {
  'UNINITIALIZED':0,
  'CONNECTING':1,
  'WAITING_OPPONENT':2,
  'PLAYING':3,
  'END':4
};

module.exports = {
  'Gameplay':Gameplay,
  'stateCodes':stateCodes
};
