class TicTacToe:
    def __init__(self):
        self.board = [" " for _ in range(9)]
        self.current_player = "X"

    def print_board(self):
        for i in range(3):
            print(f"{self.board[i*3]} | {self.board[i*3+1]} | {self.board[i*3+2]}")
            if i < 2:
                print("-" * 9)

    def check_winner(self):
        # Check rows
        for i in range(3):
            if self.board[i*3] == self.board[i*3+1] == self.board[i*3+2] != " ":
                return True
        # Check columns
        for i in range(3):
            if self.board[i] == self.board[i+3] == self.board[i+6] != " ":
                return True
        # Check diagonals
        if self.board[0] == self.board[4] == self.board[8] != " " or \n           self.board[2] == self.board[4] == self.board[6] != " ":
            return True
        return False

    def play_game(self):
        while True:
            self.print_board()
            move = int(input(f"Player {self.current_player}, enter your move (0-8): "))

            if self.board[move] != " ":
                print("Invalid move. Try again.")
                continue

            self.board[move] = self.current_player

            if self.check_winner():
                self.print_board()
                print(f"Player {self.current_player} wins!")
                break

            if all(cell != " " for cell in self.board):
                self.print_board()
                print("It's a draw!")
                break

            self.current_player = "O" if self.current_player == "X" else "X"

# Start the game
 game = TicTacToe()
 game.play_game()