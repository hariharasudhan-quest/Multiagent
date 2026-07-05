from typing import Iterator

CELL_EMPTY = "_"
CELL_X = "X"
CELL_O = "O"

BOARD_SIZE = 3

board = [
    [ CELL_EMPTY for cell in range(BOARD_SIZE)]
    for row in range(BOARD_SIZE)
]

def check_cells_for_winner(cells: Iterator[str]):
    counts = {
        CELL_EMPTY: 0,
        CELL_X: 0,
        CELL_O: 0,
    }

    for cell in cells:
        counts[cell] += 1

    if counts[CELL_X] >= BOARD_SIZE:
        return CELL_X
    if counts[CELL_O] >= BOARD_SIZE:
        return CELL_O
    return None

def check_cell_sets_for_winner(cell_sets: Iterator[Iterator[str]]):
    for cells in cell_sets:
        winner = check_cells_for_winner(cells)
        if winner is not None:
            return winner
    return None


def check_winner(b):

    def cells_in_row(b, row):
        for col in range(BOARD_SIZE):
            yield b[row][col]
    
    def cells_in_column(b, col):
        for row in range(BOARD_SIZE):
            yield b[row][col]

    def cells_in_forward_diagonal(b):
        for i in range(BOARD_SIZE):
            yield b[i][i]

    def cells_in_reverse_diagonal(b):
        for i in range(BOARD_SIZE):
            yield b[i][BOARD_SIZE - 1 - i]

    def cell_sets(b):
        for row in range(BOARD_SIZE):
            yield cells_in_row(b, row)
        for col in range(BOARD_SIZE):
            yield cells_in_column(b, col)
        yield cells_in_forward_diagonal(b)
        yield cells_in_reverse_diagonal(b)

    return check_cell_sets_for_winner(cell_sets(b))

def has_empty_cells(b):
    for row in range(BOARD_SIZE):
        for col in range(BOARD_SIZE):
            if b[row][col] == CELL_EMPTY:
                return True
    return False

def print_board(b):
    for row in range(BOARD_SIZE):
        for col in range(BOARD_SIZE):
            print(b[row][col], end="")
        print()

players = [
    CELL_X,
    CELL_O,
]
player_index = 0
player_count = len(players)

print_board(board)
while check_winner(board) is None and has_empty_cells(board):
    user_input_str = input("Enter the cell to place: ")
    try:
        user_input_int = int(user_input_str) - 1
        r = user_input_int // BOARD_SIZE
        c = user_input_int % BOARD_SIZE
        if board[r][c] != CELL_EMPTY:
            print("Invalid")
            continue
        board[r][c] = players[player_index]
        player_index = (player_index + 1) % player_count
        print()
        print_board(board)
    except:
        print("Invalid")

print("The winner is: " + check_winner(board))