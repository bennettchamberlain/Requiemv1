import 'dart:async';

import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_models/scoria_models.dart';
import 'package:scoria_app/chat/parts/chat_part.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:speech_to_text/speech_to_text.dart';

class VoiceState extends Equatable {
  const new({
    this.enabled = false,
    this.listening = false,
    this.speaking = false,
    this.sttAvailable = false,
    this.ttsAvailable = false,
    this.sidecarLive = false,
    this.sidecarLoaded = false,
    this.sidecarLoading = false,
    this.sidecarStarting = false,
    this.sidecarModel,
    this.keepUntil,
    this.partial = '',
    this.lastHeard,
    this.heardSeq = 0,
    this.spokenMessageId,
    this.error,
  });

  /// User wants replies spoken and the mic offered.
  final bool enabled;
  final bool listening;
  final bool speaking;
  final bool sttAvailable;
  final bool ttsAvailable;
  final bool sidecarLive;
  final bool sidecarLoaded;
  final bool sidecarLoading;
  final bool sidecarStarting;
  final String? sidecarModel;
  final DateTime? keepUntil;
  final String partial;
  final String? lastHeard;
  final int heardSeq;
  final String? spokenMessageId;
  final String? error;

  VoiceState copyWith({
    bool? enabled,
    bool? listening,
    bool? speaking,
    bool? sttAvailable,
    bool? ttsAvailable,
    bool? sidecarLive,
    bool? sidecarLoaded,
    bool? sidecarLoading,
    bool? sidecarStarting,
    String? sidecarModel,
    DateTime? keepUntil,
    String? partial,
    String? lastHeard,
    int? heardSeq,
    String? spokenMessageId,
    String? error,
    bool clearHeard = false,
    bool clearError = false,
    bool clearSidecarModel = false,
  }) {
    return VoiceState(
      enabled: enabled ?? this.enabled,
      listening: listening ?? this.listening,
      speaking: speaking ?? this.speaking,
      sttAvailable: sttAvailable ?? this.sttAvailable,
      ttsAvailable: ttsAvailable ?? this.ttsAvailable,
      sidecarLive: sidecarLive ?? this.sidecarLive,
      sidecarLoaded: sidecarLoaded ?? this.sidecarLoaded,
      sidecarLoading: sidecarLoading ?? this.sidecarLoading,
      sidecarStarting: sidecarStarting ?? this.sidecarStarting,
      sidecarModel: clearSidecarModel
          ? null
          : sidecarModel ?? this.sidecarModel,
      keepUntil: keepUntil ?? this.keepUntil,
      partial: partial ?? this.partial,
      lastHeard: clearHeard ? null : lastHeard ?? this.lastHeard,
      heardSeq: heardSeq ?? this.heardSeq,
      spokenMessageId: spokenMessageId ?? this.spokenMessageId,
      error: clearError ? null : error ?? this.error,
    );
  }

  @override
  List<Object?> get props => [
    enabled,
    listening,
    speaking,
    sttAvailable,
    ttsAvailable,
    sidecarLive,
    sidecarLoaded,
    sidecarLoading,
    sidecarStarting,
    sidecarModel,
    keepUntil,
    partial,
    lastHeard,
    heardSeq,
    spokenMessageId,
    error,
  ];
}

/// Local mouth and ears for chat. Thinking stays on Parasail through the API.
class VoiceCubit extends Cubit<VoiceState> {
  VoiceCubit({
    required ScoriaApiClient api,
    SharedPreferences? prefs,
  }) : _api = api,
       _prefs = prefs,
       super(VoiceState(enabled: prefs?.getBool(_enabledKey) ?? false));

  static const _enabledKey = 'requiem.voice.enabled';

  final ScoriaApiClient _api;
  final SharedPreferences? _prefs;
  SpeechToText? _stt;
  FlutterTts? _tts;

  Future<void> setEnabled({required bool on}) async {
    emit(state.copyWith(enabled: on, clearError: true));
    await _prefs?.setBool(_enabledKey, on);
    if (on) {
      await prepareSpeak();
      unawaited(startSidecar());
    } else {
      await stopListen();
      await _tts?.stop();
      emit(state.copyWith(speaking: false));
    }
  }

  void applyStatus(VoiceStatus status) {
    emit(
      state.copyWith(
        sidecarLive: status.available && (status.live || status.loaded),
        sidecarLoaded: status.loaded,
        sidecarLoading: status.loading,
        sidecarModel: status.model ?? status.provider,
        keepUntil: status.keepUntil,
        clearSidecarModel: status.model == null && status.provider == null,
        clearError: true,
      ),
    );
  }

  Future<void> refreshSidecar() async {
    try {
      applyStatus(await _api.voiceStatus());
    } on Object {
      emit(
        state.copyWith(
          sidecarLive: false,
          sidecarLoaded: false,
          sidecarLoading: false,
          clearSidecarModel: true,
        ),
      );
    }
  }

  /// Start or warm the GPU sidecar. Returns when it is loaded or the
  /// poll budget runs out. First start can take a couple of minutes.
  Future<void> startSidecar() async {
    if (state.sidecarStarting) return;
    emit(state.copyWith(sidecarStarting: true, clearError: true));
    try {
      applyStatus(await _api.voiceStart());
      for (var i = 0; i < 90 && !state.sidecarLoaded; i++) {
        if (!state.sidecarLoading && i > 2) break;
        await Future<void>.delayed(const Duration(seconds: 2));
        applyStatus(await _api.voiceStatus());
      }
    } on Object catch (e) {
      emit(state.copyWith(error: '$e', sidecarStarting: false));
      return;
    }
    emit(state.copyWith(sidecarStarting: false));
  }

  Future<bool> prepareSpeak() async {
    if (state.ttsAvailable) return true;
    try {
      final tts = FlutterTts();
      await tts.setSpeechRate(0.48);
      await tts.awaitSpeakCompletion(true);
      _tts = tts;
      emit(state.copyWith(ttsAvailable: true, clearError: true));
      return true;
    } on Object catch (e) {
      emit(state.copyWith(ttsAvailable: false, error: '$e'));
      return false;
    }
  }

  Future<bool> prepareListen() async {
    if (state.sttAvailable) return true;
    try {
      final stt = SpeechToText();
      final ok = await stt.initialize(
        onError: (e) => emit(
          state.copyWith(listening: false, error: e.errorMsg),
        ),
        onStatus: (status) {
          if (status == 'done' || status == 'notListening') {
            emit(state.copyWith(listening: false));
          }
        },
      );
      if (!ok) {
        emit(
          state.copyWith(
            sttAvailable: false,
            error: 'Microphone is not available on this device.',
          ),
        );
        return false;
      }
      _stt = stt;
      emit(state.copyWith(sttAvailable: true, clearError: true));
      return true;
    } on Object catch (e) {
      emit(state.copyWith(sttAvailable: false, error: '$e'));
      return false;
    }
  }

  Future<void> toggleListen() async {
    if (state.listening) {
      await stopListen();
      return;
    }
    if (!await prepareListen()) return;
    emit(state.copyWith(listening: true, partial: '', clearError: true));
    try {
      await _stt!.listen(
        onResult: (result) {
          emit(state.copyWith(partial: result.recognizedWords));
          if (!result.finalResult) return;
          final text = result.recognizedWords.trim();
          emit(
            state.copyWith(
              listening: false,
              lastHeard: text.isEmpty ? null : text,
              heardSeq: text.isEmpty ? state.heardSeq : state.heardSeq + 1,
              partial: '',
              clearHeard: text.isEmpty,
            ),
          );
        },
        listenOptions: SpeechListenOptions(
          listenFor: const Duration(seconds: 20),
          pauseFor: const Duration(seconds: 3),
        ),
      );
    } on Object catch (e) {
      emit(state.copyWith(listening: false, error: '$e'));
    }
  }

  Future<void> stopListen() async {
    try {
      await _stt?.stop();
    } on Object {
      // Plugin already idle.
    }
    final leftover = state.partial.trim();
    emit(
      state.copyWith(
        listening: false,
        lastHeard: leftover.isEmpty ? state.lastHeard : leftover,
        heardSeq: leftover.isEmpty ? state.heardSeq : state.heardSeq + 1,
        partial: '',
      ),
    );
  }

  Future<void> speak(String text) async {
    final line = text.trim();
    if (line.isEmpty) return;
    if (!await prepareSpeak()) return;
    emit(state.copyWith(speaking: true, clearError: true));
    try {
      await _tts?.stop();
      await _tts?.speak(line);
    } on Object catch (e) {
      emit(state.copyWith(speaking: false, error: '$e'));
      return;
    }
    emit(state.copyWith(speaking: false));
  }

  /// Speak a finished assistant message on this device. If PersonaPlex is
  /// live on the voice box, also force those words there — thinking already
  /// happened on Parasail in the chat turn.
  Future<void> speakReply(String messageId, String content) async {
    if (!state.enabled) return;
    if (state.spokenMessageId == messageId) return;
    emit(state.copyWith(spokenMessageId: messageId));
    final lines = spokenLinesOf(content);
    if (lines.isEmpty) return;
    final spoken = lines.join(' ');
    await speak(spoken);
    if (!state.sidecarLive) return;
    try {
      await _api.voiceSay(spoken);
    } on Object {
      // Chat already spoke locally.
    }
  }
}
