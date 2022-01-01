/*\
title: $:/plugins/@tw5/y-websocket/wsserver.js
type: application/javascript
module-type: library


\*/

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

if($tw.node) {
	const { uniqueNamesGenerator, adjectives, colors, animals, names } = require('unique-names-generator');
	const WS = require('ws');
	const URL = require('url').URL;

/*
	A simple websocket server extending the `ws` library
	options: 
*/
function WebSocketServer(options) {
	const setupWSConnection = require('y-websocket/bin/utils').setupWSConnection
	Object.assign(this, new WS.Server(options));
	// Setup the httpServer
	this.httpServer = options.httpServer || null;
	// Users
	this.anonId = 0; // Incremented when an anonymous userid is created
	// Set the event handlers
	this.on('listening',this.serverOpened);
	this.on('close',this.serverClosed);
	this.on('connection',setupWSConnection);
}

WebSocketServer.prototype = Object.create(WS.Server.prototype);
WebSocketServer.prototype.constructor = WebSocketServer;

WebSocketServer.prototype.defaultVariables = {

};

WebSocketServer.prototype.serverOpened = function() {

}

WebSocketServer.prototype.serverClosed = function() {

}

WebSocketServer.prototype.verifyUpgrade = function(request,options) {
	if(request.url.indexOf("wiki=") == -1 || request.url.indexOf("session=") == -1) {
		return false
	}
	// Compose the state object
	var state = {};
	state.wiki = options.wiki || $tw.wiki;
	state.boot = options.boot || $tw.boot;
	state.server = options.server;
	state.ip = request.headers['x-forwarded-for'] ? request.headers['x-forwarded-for'].split(/\s*,\s*/)[0]:
		request.connection.remoteAddress;
	state.serverAddress = this.httpServer.protocol + "://" + this.httpServer.address().address + ":" + this.httpServer.address().port;
	state.urlInfo = new URL(request.url,state.serverAddress);
	// Get the principals authorized to access this resource
	state.authorizationType = "readers";
	// Check whether anonymous access is granted
	state.allowAnon = state.server.isAuthorized(state.authorizationType,null);
	// Authenticate with the first active authenticator
	let fakeResponse = {
		writeHead: function(){},
		end: function(){}
	}
	if(state.server.authenticators.length > 0) {
		if(!state.server.authenticators[0].authenticateRequest(request,fakeResponse,state)) {
			// Bail if we failed (the authenticator will have -not- sent the response)
			return false;
		}	
	}
	// Authorize with the authenticated username
	if(!state.server.isAuthorized(state.authorizationType,state.authenticatedUsername)) {
		return false;
	}
	let session = this.sessions.get(state.urlInfo.searchParams.get("session"));
	return !!session
		&& state.urlInfo.searchParams.get("wiki") == session.key
		&& state.authenticatedUsername == session.authenticatedUsername
		&& state
};

/**
 * @param {WebSocket} socket
 * @param {UPGRADE} request
 * @param {$tw server state} state
	This function handles incomming connections from client sessions.
	It can support multiple client sessions, each with a unique sessionId.
	Session objects are defined in $:/plugins/@tw5/y-websocket/y-wssession.js
	OUTDATED
*/
WebSocketServer.prototype.handleWSConnection = function(socket,request,state) {
	if(state && this.sessions.has(state.urlInfo.searchParams.get("session"))) {
		let session = this.sessions.get(state.urlInfo.searchParams.get("session"));	
		// Reset the connection state
		session.ip = state.ip;
		session.url = state.urlInfo;
		session.ws = socket;
		session.connecting = false;
		session.connected = true;
		session.synced = false;

		let wikiDoc = $tw.y.getYDoc(session.key);
		wikiDoc.sessions.set(session, new Set())
		session.logger.log(`Opened socket ${state.ip} (${request.connection.remoteAddress}) for Session ${session.id}`);
		// Event handlers
		socket.on('message', function(event) {
			session._messageHandler(event);
		});
		socket.on('close',(event) => {
			session.logger.log(`Closed socket ${state.ip} (${request.connection.remoteAddress}) for Session ${session.id}`);
			session.connecting = false;
			session.connected = false;
			session.synced = false;
			// Close the WikiDoc session when disconnected
			wikiDoc.emit('close',[session,event]);
			session.emit('disconnected', [{
				status: "disconnected",
				event: event 
			},session]);
		});

		session.emit('connected', [{status: "connected"},session]);
	} else {
		$tw.utils.log(`ws-server: Unauthorized Upgrade GET ${$tw.boot.origin+request.url}`);
		socket.close(4023, `Invalid`);
		return;
	}
}

/*
	User methods
*/
WebSocketServer.prototype.getAnonUsername = function(state) {
	// Query the request state server for the anon username parameter
	let anon = state.server.get("anon-username")
	return (anon || '') + uniqueNamesGenerator({
		dictionaries: [colors, adjectives, animals, names],
		style: 'capital',
		separator: '',
		length: 3,
		seed: this.anonId++
	});
}

/*
	Session methods
*/

WebSocketServer.prototype.getSessionsByUser = function(username) {
	let usersSessions = new Map();
	for (let [id,session] of this.sessions.entries()) {
		if(session.username === username) {
			usersSessions.add(id,session);
		}
	}
	return usersSessions;
}

/**
 * @param {WebsocketSession} session
 * @param {int} timeout
*/
WebSocketServer.prototype.refreshSession = function(session,timeout) {
	let eol = new Date(session.expires).getTime() + timeout;
	session.expires = new Date(eol).getTime();
}

exports.WebSocketServer = WebSocketServer;

}
