"""Repackage Google's Lite weights with the matching Tasks metadata.

No learned weights are changed. Requires numpy, flatbuffers==25.12.19, and
schema_py_generated.py + metadata_schema_py_generated.py from the official
mediapipe==0.10.21 wheel under .cache/lite-build. See docs/FAST-TRACKING.md.
"""
from pathlib import Path
import hashlib
import io
import json
import sys
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
if '--bootstrap' in sys.argv:
    tools_dir = ROOT / '.cache/lite-build'
    tools_dir.mkdir(parents=True, exist_ok=True)
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--target', str(tools_dir), 'flatbuffers==25.12.19', 'numpy==2.4.6'])
    subprocess.check_call([sys.executable, '-m', 'pip', 'download', '--no-deps', '--dest', str(tools_dir), 'mediapipe==0.10.21'])
    wheel = next(tools_dir.glob('mediapipe-0.10.21-*.whl'))
    with zipfile.ZipFile(wheel) as archive:
        for name in archive.namelist():
            if Path(name).name in ['schema_py_generated.py', 'metadata_schema_py_generated.py']:
                (tools_dir / Path(name).name).write_bytes(archive.read(name))
sys.path.insert(0, str(ROOT / '.cache/lite-build'))
import flatbuffers
import schema_py_generated as schema
import metadata_schema_py_generated as metadata_schema

MODELS = ROOT / 'public/models'
SOURCES = [
    ('hand_detector.tflite', 'palm_detection_lite', 'e9a4aaddf90dda56a87235303cf00e4c2d3fb28725f68fd88772997dac905c18'),
    ('hand_landmarks_detector.tflite', 'hand_landmark_lite', 'd7fde8ac11f8ce03f8663775bfc323f4fc9f2a38062b4f4efa142874ef5b2a48'),
]

def add_file(archive, name, contents):
    info = zipfile.ZipInfo(name, date_time=(2021, 10, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_STORED
    archive.writestr(info, contents)

full = zipfile.ZipFile(MODELS / 'hand_landmarker.task')
output = io.BytesIO()
with zipfile.ZipFile(output, 'w') as task:
    for target, source, expected in SOURCES:
        source_path = ROOT / '.cache/lite-build/input' / (source + '.tflite')
        source_path.parent.mkdir(parents=True, exist_ok=True)
        if not source_path.exists():
            source_path.write_bytes(urllib.request.urlopen('https://storage.googleapis.com/mediapipe-assets/' + source + '.tflite', timeout=60).read())
        lite_bytes = source_path.read_bytes()
        assert hashlib.sha256(lite_bytes).hexdigest() == expected, source + ' checksum mismatch'
        full_bytes = full.read(target)
        old = schema.ModelT.InitFromObj(schema.Model.GetRootAsModel(full_bytes, 0))
        new = schema.ModelT.InitFromObj(schema.Model.GetRootAsModel(lite_bytes, 0))
        old_graph, new_graph = old.subgraphs[0], new.subgraphs[0]
        for old_indices, new_indices in [(old_graph.inputs, new_graph.inputs), (old_graph.outputs, new_graph.outputs)]:
            assert len(old_indices) == len(new_indices)
            for old_i, new_i in zip(old_indices, new_indices):
                a, b = old_graph.tensors[old_i], new_graph.tensors[new_i]
                assert a.type == b.type and list(a.shape) == list(b.shape), 'Tensor contract differs'
        new.metadata = [m for m in (new.metadata or []) if m.name != b'TFLITE_METADATA']
        for item in old.metadata:
            if item.name != b'TFLITE_METADATA':
                continue
            meta = metadata_schema.ModelMetadataT.InitFromObj(metadata_schema.ModelMetadata.GetRootAsModelMetadata(old.buffers[item.buffer].data, 0))
            meta.name = ('MediaPipe ' + source + ' Lite').encode()
            meta.description = b'Official Google Lite weights. Tasks tensor metadata and labels adapted from the compatible Full bundle; weights unchanged.'
            meta_builder = flatbuffers.Builder(0)
            meta_builder.Finish(meta.Pack(meta_builder), file_identifier=b'M001')
            buffer = schema.BufferT()
            buffer.data = bytearray(meta_builder.Output())
            item.buffer = len(new.buffers)
            new.buffers.append(buffer)
            new.metadata.append(item)
        builder = flatbuffers.Builder(0)
        builder.Finish(new.Pack(builder), file_identifier=b'TFL3')
        packed = io.BytesIO(bytes(builder.Output()))
        if zipfile.is_zipfile(io.BytesIO(full_bytes)):
            labels = zipfile.ZipFile(io.BytesIO(full_bytes))
            with zipfile.ZipFile(packed, 'a') as attached:
                for name in labels.namelist():
                    add_file(attached, name, labels.read(name))
        add_file(task, target, packed.getvalue())
artifact = output.getvalue()
path = MODELS / 'hand_landmarker_lite.task'
path.write_bytes(artifact)
print(json.dumps({'file': str(path), 'bytes': len(artifact), 'sha256': hashlib.sha256(artifact).hexdigest()}))
