import subprocess
from pathlib import Path

def test_cli(input_file, output_file, desc_file, working_dir, args):
    with open(input_file, 'r') as f:
        input_content = f.read().strip()
    
    with open(output_file, 'r') as f:
        expected_output_content = f.read().strip()

    with open(desc_file, 'r') as f:
        desc_content = f.read().strip()

    result = subprocess.run(
        args,
        cwd=working_dir,
        input=input_content,
        capture_output=True,
        text=True
    )
    stdout, stderr, rc = result.stdout.strip(), result.stderr.strip(), result.returncode

    if stdout != expected_output_content:
        print("Test Failed due to output mismatch")
        print("Test Description:")
        print(desc_content)
        print("Expected:")
        print(expected_output_content)
        print()
        print("Actual:")
        print(stdout)
        
        return False
    
    return True

def run_tests(tests_dir, working_dir, args):
    tests_dir_path = Path(tests_dir)
    if not tests_dir_path.exists() or not tests_dir_path.is_dir():
        return
    test_dirs = [ d for d in tests_dir_path.iterdir() if d.is_dir() ]
    test_dirs.sort()
    for test_dir in test_dirs:
        print("Testing " + test_dir._str)
        is_success = test_cli(test_dir / 'stdin.txt', test_dir / 'stdout.txt', test_dir / 'desc.txt', working_dir, args)
        if not is_success:
            exit(1)

run_tests("tests", ".", ["uv", "run", "main.py"])