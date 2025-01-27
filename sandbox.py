import json
import numpy as np
import msgpack
import zipfile
import io

original_file = 'static/data/h2_emission_cube.json'
with open(original_file, 'r') as f:
    h2_emission_cube = json.load(f)

wavelengths = h2_emission_cube['wavelengths']
h2_emission_cube = h2_emission_cube['fluxes']

# np.savez_compressed('static/data/h2_emission_cube.npz', wavelengths=wavelengths, fluxes=h2_emission_cube)

with open('static/data/h2_emission_cube.msgpack', 'wb') as f:
    packed = msgpack.packb(h2_emission_cube, use_bin_type=True)
    f.write(packed)