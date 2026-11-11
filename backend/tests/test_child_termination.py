import pytest
from tests.conftest import H


def lesson(client, child, day):
    response = client.post('/schedules', headers=H(), json={'child_id': child['id'], 'date': day, 'start': '09:00'})
    assert response.status_code == 201
    return response.json()


def test_termination_preserves_past_and_cancels_from_inclusive_cutoff(client, repo, child):
    cid = child['id']
    past = lesson(client, child, '2026-10-30')
    end = lesson(client, child, '2026-11-02')
    future = lesson(client, child, '2026-12-02')
    for s in (past, end):
        assert client.put(f"/schedules/{s['id']}/attendance", headers=H(), json={'status': 'late', 'minutes_late': 5}).status_code == 200
    old_mark = repo.get('attendance', 'orgA', past['id'])
    for day in ('2026-11-02', '2026-11-03'):
        repo.create('therapy_sessions', 'orgA', {'child_id': cid, 'date': day, 'start': '09:00', 'end': '09:40', 'status': 'completed'})
    repo.create('pay_plans', 'orgA', {'child_id': cid, 'month': '2026-11', 'same_as_actual': False, 'slots': [{'date': '2026-11-01', 'start': '09:00'}, {'date': '2026-11-02', 'start': '09:00'}]}, doc_id=cid+'_2026-11')
    url = f'/children/{cid}/terminate'
    for _ in range(2):
        assert client.post(url, headers=H(), json={'terminated_on': '2026-11-02'}).status_code == 200
    assert repo.get('schedules', 'orgA', past['id']) == past
    assert repo.get('attendance', 'orgA', past['id']) == old_mark
    for s in (end, future):
        assert repo.get('schedules', 'orgA', s['id'])['status'] == 'cancelled'
    assert client.get('/children', headers=H()).json() == []
    [ended] = client.get('/children/terminated', headers=H()).json()
    assert ended == {k: {**child, 'terminated_on': '2026-11-02'}[k] for k in ('id', 'alias', 'display_name', 'terminated_on')}
    assert client.get('/attendance/day?on=2026-11-02', headers=H()).json() == []
    assert client.get('/month-sheet?month=2026-11', headers=H()).json()['classes'] == []
    assert repo.get('pay_plans', 'orgA', cid+'_2026-11')['slots'] == [{'date': '2026-11-01', 'start': '09:00'}]
    assert client.get(f'/children/{cid}/voucher-visits?month=2026-12', headers=H()).json()['visits'] == []
    assert client.get('/settlement?month=2026-12', headers=H(role='admin')).json()['rows'] == []
    assert client.post('/schedules', headers=H(), json={'child_id': cid, 'date': '2026-11-02', 'start': '11:00'}).status_code == 409
    assert client.put(f"/schedules/{past['id']}", headers=H(), json={'date': '2026-11-03', 'start': '11:00'}).status_code == 409
    assert client.post(url, headers=H(), json={'terminated_on': '2026-11-03'}).status_code == 409
    assert client.post(f'/children/{cid}/purge', headers=H(role='admin'), json={'confirm_name': child['display_name']}).status_code == 409
    assert len(repo.list('audit_logs', 'orgA', action='terminate')) == 1


def test_terminated_weekly_entries_do_not_regenerate(client, repo, child):
    cid = child['id']
    assert client.put('/timetable/config', headers=H(role='admin'), json={'teachers': [{'id': 't', 'name': child['therapist'], 'short': '테', 'color': '#2563eb'}]}).status_code == 200
    for start in ('2026-10-01', '2026-12-01'):
        assert client.post('/timetable/entries', headers=H(), json={'child_id': cid, 'day': 1, 'slot': '09:00', 'teacher_id': 't', 'valid_from': start, 'valid_to': '2026-11-30' if start == '2026-10-01' else None}).status_code == 201
    assert client.post(f'/children/{cid}/terminate', headers=H(), json={'terminated_on': '2026-11-02'}).status_code == 200
    assert client.get('/schedules?month=2026-12', headers=H()).json() == []
    assert client.get('/month-sheet?month=2026-10', headers=H()).json()['classes']
    entries = client.get('/timetable', headers=H()).json()['entries']
    assert len(entries) == 1 and entries[0]['valid_to'] == '2026-11-01'


@pytest.mark.parametrize('headers,code', [(H(org='other', role='admin'), 404), (H(uid='other'), 404), (H(role='assistant'), 403)])
def test_termination_scope(client, child, headers, code):
    assert client.post(f"/children/{child['id']}/terminate", headers=headers, json={'terminated_on': '2026-11-02'}).status_code == code
    assert client.get('/children/terminated', headers=headers).json() == []


def test_voucher_grade_always_sets_disability_registered(client, repo, child):
    cid = child['id']
    assert client.put(f'/children/{cid}/voucher', headers=H(), json={'voucher_grade': '나'}).json()['disability_registered'] is True
    assert client.put(f'/children/{cid}/disability', headers=H(), json={'disability_registered': False}).status_code == 409
    body = {k: child[k] for k in ('alias', 'display_name', 'birth_date', 'therapist')}
    assert client.post('/children/import', headers=H(), json={'overwrite': True, 'rows': [{**body, 'disability_registered': False}]}).status_code == 200
    assert repo.get('children', 'orgA', cid)['disability_registered'] is True
    created = client.post('/children', headers=H(), json={**body, 'alias': 'NEW', 'display_name': '가상새아동', 'voucher_grade': '가', 'disability_registered': False}).json()
    assert created['disability_registered'] is True
