from fastapi import APIRouter, Request, Response
from .frame_processing import reject
from .vision_models import (AcceptRequest, CalibrationRequest, CalibrationPreview, ResetRequest,
                            SessionInfo, SnapshotInfo, SnapshotRequest)

router = APIRouter(prefix='/api/sessions', tags=['Tabletop vision'])


@router.post('', response_model=SessionInfo)
def create_session(request: Request):
    return request.app.state.sessions.create()


@router.delete('/{session_id}', status_code=204)
def delete_session(session_id: str, request: Request):
    request.app.state.sessions.delete(session_id)
    return Response(status_code=204)


@router.post('/{session_id}/reset', response_model=SessionInfo)
def reset(session_id: str, body: ResetRequest, request: Request):
    with request.app.state.sessions.use(session_id) as session:
        session.check_revision(body.expected_revision)
        session.reset(scene=body.scope == 'scene')
        return session.info()


@router.post('/{session_id}/snapshot', response_model=SnapshotInfo)
def snapshot(session_id: str, body: SnapshotRequest, request: Request):
    with request.app.state.sessions.use(session_id) as session:
        return session.freeze(body)


@router.get('/{session_id}/snapshot/{snapshot_id}')
def snapshot_image(session_id: str, snapshot_id: str, request: Request):
    with request.app.state.sessions.use(session_id) as session:
        if not session.snapshot or session.snapshot[0] != snapshot_id:
            reject(404, 'SNAPSHOT_EXPIRED', 'Snapshot no longer exists. Capture another processed frame.')
        return Response(session.snapshot[3], media_type='image/jpeg', headers={'Cache-Control': 'no-store'})


@router.post('/{session_id}/calibration/preview', response_model=CalibrationPreview)
def preview(session_id: str, body: CalibrationRequest, request: Request):
    with request.app.state.sessions.use(session_id) as session:
        return session.preview(body)


@router.post('/{session_id}/calibration/accept', response_model=SessionInfo)
def accept(session_id: str, body: AcceptRequest, request: Request):
    with request.app.state.sessions.use(session_id) as session:
        return session.accept(body)
